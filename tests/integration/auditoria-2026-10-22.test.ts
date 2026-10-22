import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { ComprasService } from "@/lib/services/compras.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { FiadoService } from "@/lib/services/fiado.service";
import { VendasService } from "@/lib/services/vendas.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { AvisosService } from "@/lib/services/avisos.service";
import { BillingService } from "@/lib/services/billing.service";
import { buildReport } from "@/lib/reports/report.service";
import { resolvePeriod } from "@/lib/dates";
import { COMPRA_EXPENSE_CATEGORY } from "@/lib/constants";
import { addDaysTz, isoDateTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Correções da auditoria de 22/10 que dependem de banco: corrida entre cancelar
 * a venda e baixar o fiado, baixa de embalagem (idempotência e desfazer), conta
 * de higienização paga em partes, "a pagar no mês", fiado sem vencimento nos
 * avisos, relatórios que fecham com o Início e o status gravado no dia da troca
 * de plano agendada.
 */

const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");
const hoje = isoDateTz();
const sufixo = () => randomUUID().slice(0, 6);

/** Dia 1º do mês passado e dia 15 do mês passado, "AAAA-MM-DD". */
function mesPassado(dia: number): string {
  const [a, m] = hoje.split("-").map(Number) as [number, number];
  const ano = m === 1 ? a - 1 : a;
  const mes = m === 1 ? 12 : m - 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

beforeAll(async () => {
  tenantId = await createTestTenant("AUDITORIA 22-10");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  await prisma.expenseCategory.create({
    data: { tenantId, name: COMPRA_EXPENSE_CATEGORY, isDefault: true },
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

async function produtoComEstoque(nome: string, qtd = 50, custo = 10) {
  const p = await getTenantPrisma(tenantId).product.create({
    data: { tenantId, name: `${nome} ${sufixo()}`, saleUnit: "CAIXA" },
  });
  await ComprasService.registrarCompra(
    { purchaseDate: hoje, freight: 0, items: [{ productId: p.id, quantity: qtd, unitPrice: custo }] },
    ctx,
  );
  return p.id;
}

async function tipoComEstoque(qtd: number, custo: number) {
  const tipo = await prisma.packagingType.create({
    data: { tenantId, name: `Papelão ${sufixo()}` },
  });
  await EmbalagensService.ativarControleEstoque({ packagingTypeId: tipo.id, quantidadeAtual: 0 }, ctx);
  if (qtd > 0) {
    await EmbalagensService.registrarEntrada({ packagingTypeId: tipo.id, quantity: qtd, unitCost: custo }, ctx);
  }
  return tipo.id;
}

const financeiro = () => DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");

describe("cancelar a venda fiada x baixar o fiado como perda", () => {
  it("a baixa que entrou depois da leitura não é apagada junto com a conta", async () => {
    const produto = await produtoComEstoque("Jiló");
    const conta = await FiadoService.create(
      { customerName: `Corrida ${sufixo()}`, saleDate: hoje, items: [{ productId: produto, quantity: 2, unitPrice: 40 }] },
      ctx,
    );
    // A baixa de outra tela commitou entre a leitura do cancelamento (conta
    // ainda EM_ABERTO) e a transação dele: só a marca da baixa está lá.
    await prisma.creditAccount.update({ where: { id: conta.id }, data: { writtenOffAt: new Date() } });

    await expect(VendasService.cancelarVenda({ id: conta.saleId! }, ctx)).rejects.toThrow(
      /baixado como perda/,
    );
    const depois = await prisma.creditAccount.findUniqueOrThrow({ where: { id: conta.id } });
    expect(depois.deletedAt).toBeNull();
    const venda = await prisma.sale.findUniqueOrThrow({ where: { id: conta.saleId! } });
    expect(venda.cancelledAt).toBeNull();
  });
});

describe("baixa de embalagem", () => {
  it("o reenvio com a mesma chave não baixa duas vezes", async () => {
    const tipo = await tipoComEstoque(10, 3);
    const input = { packagingTypeId: tipo, quantity: 4, motivo: "molhou", idempotencyKey: randomUUID() };
    const a = await EmbalagensService.registrarBaixa(input, ctx);
    const b = await EmbalagensService.registrarBaixa(input, ctx);
    expect(b.id).toBe(a.id);
    expect((await EmbalagensService.saldos(tenantId)).get(tipo)).toBe(6);
  });

  it("desfazer devolve o saldo e tira o custo do mês", async () => {
    const tipo = await tipoComEstoque(10, 3);
    const antes = await financeiro();
    const baixa = await EmbalagensService.registrarBaixa(
      { packagingTypeId: tipo, quantity: 4, motivo: "rasgou" },
      ctx,
    );
    expect(Number((await financeiro()).custoEmbalagensMes) - Number(antes.custoEmbalagensMes)).toBe(12);

    await EmbalagensService.desfazerBaixa({ id: baixa.id }, ctx);
    expect((await EmbalagensService.saldos(tenantId)).get(tipo)).toBe(10);
    const depois = await financeiro();
    expect(Number(depois.custoEmbalagensMes)).toBe(Number(antes.custoEmbalagensMes));
    expect(Number(depois.lucroMes)).toBe(Number(antes.lucroMes));

    await expect(EmbalagensService.desfazerBaixa({ id: baixa.id }, ctx)).rejects.toThrow(/já foi desfeita/);
  });

  it("desfazer recusa depois de outro movimento do tipo", async () => {
    const tipo = await tipoComEstoque(10, 3);
    const baixa = await EmbalagensService.registrarBaixa(
      { packagingTypeId: tipo, quantity: 2, motivo: "sumiu" },
      ctx,
    );
    await EmbalagensService.createSale(
      { packagingTypeId: tipo, customerName: null, saleDate: hoje, quantity: 1, unitPrice: 5 },
      ctx,
    );
    await expect(EmbalagensService.desfazerBaixa({ id: baixa.id }, ctx)).rejects.toThrow(/depois desta/);
  });

  it("o par baixa/desfazer não entra no custo médio do tipo", async () => {
    const tipo = await tipoComEstoque(10, 3);
    const baixa = await EmbalagensService.registrarBaixa(
      { packagingTypeId: tipo, quantity: 4, motivo: "molhou" },
      ctx,
    );
    await EmbalagensService.desfazerBaixa({ id: baixa.id }, ctx);
    await EmbalagensService.registrarEntrada({ packagingTypeId: tipo, quantity: 10, unitCost: 5 }, ctx);
    const venda = await EmbalagensService.createSale(
      { packagingTypeId: tipo, customerName: null, saleDate: hoje, quantity: 1, unitPrice: 8 },
      ctx,
    );
    // 10 a R$ 3 + 10 a R$ 5 = R$ 4,00.
    expect(Number(venda.unitCostAtSale)).toBe(4);
  });
});

describe("higienização paga em partes na lista de contas pagas", () => {
  it("cada mês mostra só o que foi pago nele", async () => {
    await CaixasService.registrar({ type: "ENTRADA", quantity: 10, dirty: true, movementDate: hoje }, ctx);
    const lote = await HigienizacaoService.create(
      { cleanerName: `Lava Partes ${sufixo()}`, sentDate: mesPassado(1), sentQty: 10, unitPrice: 30, notes: null },
      ctx,
    );
    await HigienizacaoService.registrarPagamento({ id: lote.id, amount: 100, paidDate: mesPassado(15) }, ctx);
    await HigienizacaoService.registrarPagamento({ id: lote.id, amount: 200, paidDate: hoje }, ctx);

    const pagas = (from: string, to: string) =>
      DespesasService.listContas(
        tenantId,
        { status: "PAGO", dateField: "paidDate", from, to, q: lote.cleanerName, take: 50 },
        ctx.session.modules,
      );
    const anterior = await pagas(mesPassado(1), mesPassado(28));
    expect(anterior.map((c) => c.amount)).toEqual(["100.00"]);
    const atual = await pagas(hoje.slice(0, 8) + "01", hoje);
    expect(atual.map((c) => c.amount)).toEqual(["200.00"]);
  });
});

describe("'A pagar no mês' só com higienização enviada no mês", () => {
  it("o lote do mês passado em aberto fica nas vencidas, não no a pagar", async () => {
    const antes = await DespesasService.resumoMes(tenantId, undefined, new Date(), ctx.session.modules);
    await CaixasService.registrar({ type: "ENTRADA", quantity: 5, dirty: true, movementDate: hoje }, ctx);
    await HigienizacaoService.create(
      { cleanerName: `Lava Antigo ${sufixo()}`, sentDate: mesPassado(5), sentQty: 5, unitPrice: 10, notes: null },
      ctx,
    );
    const depois = await DespesasService.resumoMes(tenantId, undefined, new Date(), ctx.session.modules);
    expect(Number(depois.aPagar)).toBe(Number(antes.aPagar));
    expect(Number(depois.vencidas) - Number(antes.vencidas)).toBe(50);
  });
});

describe("fiado sem vencimento parado há mais de 30 dias", () => {
  it("entra no aviso e na contagem de atrasadas, como no relatório", async () => {
    const avisoAntes = (await AvisosService.get(tenantId, ctx.session.modules)).find(
      (a) => a.tipo === "fiado_vencido",
    );
    const listaAntes = await FiadoService.listOpen(tenantId);

    const produto = await produtoComEstoque("Quiabo");
    const conta = await FiadoService.create(
      { customerName: `Sem Data ${sufixo()}`, saleDate: hoje, items: [{ productId: produto, quantity: 1, unitPrice: 30 }] },
      ctx,
    );
    await prisma.creditAccount.update({
      where: { id: conta.id },
      data: { createdAt: addDaysTz(new Date(), -45), dueDate: null },
    });

    const aviso = (await AvisosService.get(tenantId, ctx.session.modules)).find(
      (a) => a.tipo === "fiado_vencido",
    );
    expect(aviso).toBeDefined();
    expect(aviso!.count - (avisoAntes?.count ?? 0)).toBe(1);
    expect(aviso!.label).toContain("atrasado");
    expect((await FiadoService.listOpen(tenantId)).vencidas - listaAntes.vencidas).toBe(1);

    const p = resolvePeriod({ preset: "mes" });
    const rel = await buildReport("INADIMPLENTES", { tenantId, from: p.from, to: p.to });
    expect(rel.rows.some((r) => r.customerName === conta.customerName)).toBe(true);
  });
});

describe("relatórios fecham com o Início", () => {
  it("'Entra no lucro' do relatório de despesas = 'Contas do mês'", async () => {
    await prisma.expense.create({
      data: {
        tenantId,
        origem: "MANUAL",
        description: "Luz",
        amount: 70,
        type: "FIXA",
        status: "PENDENTE",
        dueDate: new Date(),
      },
    });
    await CaixasService.registrar({ type: "ENTRADA", quantity: 3, dirty: true, movementDate: hoje }, ctx);
    await HigienizacaoService.create(
      { cleanerName: `Lava Mês ${sufixo()}`, sentDate: hoje, sentQty: 3, unitPrice: 7, notes: null },
      ctx,
    );
    const p = resolvePeriod({ preset: "mes" });
    const rel = await buildReport("DESPESAS", {
      tenantId,
      from: p.from,
      to: p.to,
      toVencimento: p.toVencimento,
      modules: ctx.session.modules,
    });
    const inicio = await financeiro();
    expect(Number(rel.totals!.noLucro)).toBe(Number(inicio.despesasLucroMes));
    // A compra aparece no relatório, mas não no lucro.
    expect(Number(rel.totals!.amount)).toBeGreaterThan(Number(rel.totals!.noLucro));
  });

  it("o custo total do 'Lucro por produto' = o CMV do Início, sem perder centavos", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await getTenantPrisma(tenantId).product.create({
        data: { tenantId, name: `Terço ${i} ${sufixo()}`, saleUnit: "CAIXA" },
      });
      ids.push(p.id);
    }
    // Preço zero e R$ 3 de frete rateado pela quantidade: R$ 0,3333 cada.
    await ComprasService.registrarCompra(
      { purchaseDate: hoje, freight: 3, items: ids.map((productId) => ({ productId, quantity: 3, unitPrice: 0 })) },
      ctx,
    );
    await FiadoService.create(
      {
        customerName: `Centavos ${sufixo()}`,
        saleDate: hoje,
        items: ids.map((productId) => ({ productId, quantity: 1, unitPrice: 2 })),
      },
      ctx,
    );
    const p = resolvePeriod({ preset: "mes" });
    const rel = await buildReport("LUCRO_PRODUTO", { tenantId, from: p.from, to: p.to });
    const inicio = await financeiro();
    expect(Number(rel.totals!.custo)).toBe(Number(inicio.cmvMes));
  });
});

describe("cron no dia da troca de plano agendada", () => {
  it("aplica a troca E grava o status recalculado no mesmo dia", async () => {
    const [vigente, novo] = await Promise.all(
      ["vigente", "novo"].map((s) =>
        prisma.plan.create({
          data: {
            name: `Plano ${s}`,
            slug: `auditoria-2210-${s}-${sufixo()}`,
            priceMonthly: 49.9,
            active: true,
            features: { modules: [] },
          },
        }),
      ),
    );
    const t = await createTestTenant("TROCA AGENDADA 22-10");
    tenants.push(t);
    const venceu = addDaysTz(new Date(), -1);
    const sub = await prisma.tenantSubscription.create({
      data: {
        tenantId: t,
        planId: vigente!.id,
        status: "ATIVO",
        monthlyAmount: 49.9,
        activatedAt: addDaysTz(new Date(), -40),
        currentPeriodEnd: venceu,
        graceDays: 5,
        pendingPlanId: novo!.id,
        pendingPlanFrom: venceu,
      },
    });

    await BillingService.recomputeStatuses();

    const depois = await prisma.tenantSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(depois.planId).toBe(novo!.id);
    expect(depois.status).toBe("VENCIDO");

    await cleanupTenants([t]);
    tenants.splice(tenants.indexOf(t), 1);
    await prisma.plan.deleteMany({ where: { id: { in: [vigente!.id, novo!.id] } } });
  });
});

describe("editar a data ou o higienizador do envio", () => {
  it("estorna a saída antiga e lança a nova, sem mudar o saldo", async () => {
    await CaixasService.registrar({ type: "ENTRADA", quantity: 6, dirty: true, movementDate: hoje }, ctx);
    const lote = await HigienizacaoService.create(
      { cleanerName: `Lava Velho ${sufixo()}`, sentDate: mesPassado(5), sentQty: 6, unitPrice: 2, notes: null },
      ctx,
    );
    const saldoAntes = await CaixasService.getSaldo(tenantId);
    const novoNome = `Lava Novo ${sufixo()}`;
    await HigienizacaoService.update(
      { id: lote.id, cleanerName: novoNome, sentDate: hoje, sentQty: 6, unitPrice: 2, notes: null },
      ctx,
    );

    const movs = await prisma.plasticCrateMovement.findMany({
      where: { tenantId, crateCleaningId: lote.id },
      orderBy: { createdAt: "asc" },
    });
    expect(movs.map((m) => [m.type, m.quantity, isoDateTz(m.movementDate), m.cleanerName])).toEqual([
      ["SAIDA_HIGIENIZACAO", 6, mesPassado(5), lote.cleanerName],
      ["ESTORNO_SAIDA_HIGIENIZACAO", 6, mesPassado(5), lote.cleanerName],
      ["SAIDA_HIGIENIZACAO", 6, hoje, novoNome],
    ]);
    expect(await CaixasService.getSaldo(tenantId)).toEqual(saldoAntes);
  });
});

describe("fiado antigo SEM venda baixado como perda", () => {
  it("sai do 'a receber' mas nem a perda nem o recebimento depois mexem no lucro", async () => {
    const conta = await prisma.creditAccount.create({
      data: { tenantId, customerName: `Legado ${sufixo()}`, totalAmount: 80, paidAmount: 0 },
    });
    const antes = await financeiro();
    await FiadoService.baixarComoPerda({ id: conta.id, motivo: "fechou o box" }, ctx);
    const depoisDaBaixa = await financeiro();
    expect(Number(depoisDaBaixa.perdasFiadoMes)).toBe(Number(antes.perdasFiadoMes));
    expect(Number(depoisDaBaixa.lucroMes)).toBe(Number(antes.lucroMes));

    await FiadoService.registrarPagamento({ accountId: conta.id, amount: 30, method: "PIX" }, ctx);
    const depoisDoPagamento = await financeiro();
    expect(Number(depoisDoPagamento.recuperadoFiadoMes)).toBe(Number(antes.recuperadoFiadoMes));
    expect(Number(depoisDoPagamento.lucroMes)).toBe(Number(antes.lucroMes));

    const p = resolvePeriod({ preset: "mes" });
    const rel = await buildReport("FIADO_PERDAS", { tenantId, from: p.from, to: p.to });
    const linhas = rel.rows.filter((r) => r.customerName === conta.customerName);
    expect(linhas.map((r) => r.tipo)).toEqual([
      "Baixa como perda (sem venda — fora do lucro)",
      "Recebido depois da baixa (sem venda — fora do lucro)",
    ]);
    expect(linhas.every((r) => r.perda === null && r.recuperado === null)).toBe(true);
    expect(rel.columns.some((c) => c.key === "foraDoLucro")).toBe(true);
  });

  it("o fiado COM venda continua descontando do lucro", async () => {
    const produto = await produtoComEstoque("Inhame");
    const conta = await FiadoService.create(
      { customerName: `Com Venda ${sufixo()}`, saleDate: hoje, items: [{ productId: produto, quantity: 1, unitPrice: 50 }] },
      ctx,
    );
    const antes = await financeiro();
    await FiadoService.baixarComoPerda({ id: conta.id, motivo: "sumiu" }, ctx);
    expect(Number((await financeiro()).perdasFiadoMes) - Number(antes.perdasFiadoMes)).toBe(50);
  });
});
