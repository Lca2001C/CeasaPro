import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { ComprasService } from "@/lib/services/compras.service";
import { VendasService } from "@/lib/services/vendas.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { FiadoService } from "@/lib/services/fiado.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { gravarStatusCalculado } from "@/lib/billing/gravar-status";
import { COMPRA_EXPENSE_CATEGORY } from "@/lib/constants";
import { civilParts, isoDateTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Correções da auditoria de 21/10 que dependem de banco: perda de estoque no
 * lucro, desfazer ajuste e entrada de embalagem, conta da compra de embalagem,
 * higienização por estorno e no prazo, idempotência do recebimento de fiado,
 * dia âncora da conta recorrente e a gravação condicional do status.
 */

const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");
const hoje = isoDateTz();

beforeAll(async () => {
  tenantId = await createTestTenant("AUDITORIA 21-10");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  await prisma.expenseCategory.create({
    data: { tenantId, name: COMPRA_EXPENSE_CATEGORY, isDefault: true },
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

async function produtoComEstoque(nome: string, qtd = 100, custo = 50) {
  const p = await getTenantPrisma(tenantId).product.create({
    data: { tenantId, name: `${nome} ${randomUUID().slice(0, 6)}`, saleUnit: "CAIXA" },
  });
  await ComprasService.registrarCompra(
    { purchaseDate: hoje, freight: 0, items: [{ productId: p.id, quantity: qtd, unitPrice: custo }] },
    ctx,
  );
  return p.id;
}

describe("perda de estoque no resultado do mês", () => {
  it("quebra desconta do lucro pelo custo; desfazer o ajuste devolve tudo", async () => {
    const produto = await produtoComEstoque("Tomate");
    await VendasService.registrarVenda(
      { paymentMethod: "DINHEIRO", items: [{ productId: produto, quantity: 80, unitPrice: 70 }] },
      ctx,
    );
    const antes = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    const quebra = await EstoqueService.registrarAjuste(
      { productId: produto, type: "QUEBRA", quantity: 20, reason: "estragou" },
      ctx,
    );
    const depois = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    expect(Number(depois.perdasEstoqueMes) - Number(antes.perdasEstoqueMes)).toBe(1000);
    expect(Number(antes.lucroMes) - Number(depois.lucroMes)).toBe(1000);

    await EstoqueService.desfazerAjuste({ id: quebra.id }, ctx);
    const desfeito = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    expect(desfeito.lucroMes.toString()).toBe(antes.lucroMes.toString());
    expect(Number(await EstoqueService.getQuantity(tenantId, produto))).toBe(20);
    // O livro-razão guarda o ajuste e o estorno — nada apagado.
    expect(
      await prisma.stockMovement.count({ where: { tenantId, productId: produto, sourceType: { in: ["MANUAL", "MANUAL_CANCELLED"] } } }),
    ).toBe(2);
  });

  it("não desfaz ajuste com movimento depois, nem duas vezes, nem depois de 24 h", async () => {
    const produto = await produtoComEstoque("Alface", 10, 5);
    const a1 = await EstoqueService.registrarAjuste(
      { productId: produto, type: "QUEBRA", quantity: 1 },
      ctx,
    );
    await EstoqueService.registrarAjuste({ productId: produto, type: "QUEBRA", quantity: 1 }, ctx);
    await expect(EstoqueService.desfazerAjuste({ id: a1.id }, ctx)).rejects.toThrow(/depois/i);

    const produto2 = await produtoComEstoque("Couve", 10, 5);
    const a2 = await EstoqueService.registrarAjuste(
      { productId: produto2, type: "AJUSTE", quantity: 3, unitCost: 5000 },
      ctx,
    );
    await EstoqueService.desfazerAjuste({ id: a2.id }, ctx);
    await expect(EstoqueService.desfazerAjuste({ id: a2.id }, ctx)).rejects.toThrow(/já foi desfeito/i);

    const a3 = await EstoqueService.registrarAjuste(
      { productId: produto2, type: "QUEBRA", quantity: 1 },
      ctx,
    );
    await prisma.stockMovement.update({
      where: { id: a3.id },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await expect(EstoqueService.desfazerAjuste({ id: a3.id }, ctx)).rejects.toThrow(/prazo/i);
  });
});

describe("compra de embalagem vira conta (fora do lucro, dentro do caixa)", () => {
  it("entrada gera conta COMPRA_EMBALAGEM paga; desfazer cancela a conta e o custo", async () => {
    const tipo = await prisma.packagingType.create({
      data: { tenantId, name: `Papelão ${randomUUID().slice(0, 6)}` },
    });
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 0 },
      ctx,
    );
    const antes = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    const entrada = await EmbalagensService.registrarEntrada(
      { packagingTypeId: tipo.id, quantity: 100, unitCost: 3 },
      ctx,
    );
    const conta = await prisma.expense.findFirstOrThrow({
      where: { packagingMovementId: entrada.id },
    });
    expect(conta.origem).toBe("COMPRA_EMBALAGEM");
    expect(Number(conta.amount)).toBe(300);
    expect(conta.status).toBe("PAGO");
    // Fora do lucro: o custo entra pela venda (custo médio), não pela conta.
    const depois = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    expect(depois.lucroMes.toString()).toBe(antes.lucroMes.toString());

    await EmbalagensService.desfazerEntrada({ id: entrada.id }, ctx);
    const cancelada = await prisma.expense.findUniqueOrThrow({ where: { id: conta.id } });
    expect(cancelada.deletedAt).toBeTruthy();
    expect((await EmbalagensService.saldos(tenantId)).get(tipo.id)).toBe(0);
  });
});

describe("higienização: só até 24 h, e por estorno", () => {
  it("excluir o envio estorna as caixas para as sujas, sem apagar o movimento", async () => {
    await CaixasService.registrar(
      { type: "ENTRADA", quantity: 30, dirty: true, movementDate: hoje },
      ctx,
    );
    const antes = await CaixasService.getSaldo(tenantId);
    const lote = await HigienizacaoService.create(
      { cleanerName: "Lavador", sentDate: hoje, sentQty: 10, unitPrice: 2 },
      ctx,
    );
    await HigienizacaoService.remove(lote.id, ctx);
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.sujas).toBe(antes.sujas);
    expect(depois.emHigienizacao).toBe(antes.emHigienizacao);
    const tipos = (
      await prisma.plasticCrateMovement.findMany({ where: { crateCleaningId: lote.id } })
    ).map((m) => m.type);
    expect(tipos.sort()).toEqual(["ESTORNO_SAIDA_HIGIENIZACAO", "SAIDA_HIGIENIZACAO"]);
  });

  it("depois de 24 h não edita nem exclui", async () => {
    const lote = await HigienizacaoService.create(
      { cleanerName: "Lavador", sentDate: hoje, sentQty: 5, unitPrice: 2 },
      ctx,
    );
    await prisma.crateCleaning.update({
      where: { id: lote.id },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await expect(HigienizacaoService.remove(lote.id, ctx)).rejects.toThrow(/prazo/i);
    await expect(
      HigienizacaoService.update(
        { id: lote.id, cleanerName: "Lavador", sentDate: hoje, sentQty: 4, unitPrice: 2 },
        ctx,
      ),
    ).rejects.toThrow(/prazo/i);
  });
});

describe("recebimento de fiado com a mesma chave não baixa a dívida duas vezes", () => {
  it("o reenvio devolve o recebimento já gravado", async () => {
    const produto = await produtoComEstoque("Banana", 10, 5);
    const venda = await VendasService.registrarVenda(
      {
        customerName: "Cliente Idempotente",
        paymentMethod: "FIADO",
        items: [{ productId: produto, quantity: 2, unitPrice: 10 }],
      },
      ctx,
    );
    const conta = await prisma.creditAccount.findFirstOrThrow({ where: { saleId: venda.id } });
    const chave = randomUUID();
    await FiadoService.registrarPagamento(
      { accountId: conta.id, amount: 5, method: "PIX", idempotencyKey: chave },
      ctx,
    );
    const repetido = await FiadoService.registrarPagamento(
      { accountId: conta.id, amount: 5, method: "PIX", idempotencyKey: chave },
      ctx,
    );
    expect(Number(repetido.paidAmount)).toBe(5);
    expect(await prisma.creditPayment.count({ where: { accountId: conta.id } })).toBe(1);
  });
});

describe("conta recorrente de dia 31", () => {
  it("fevereiro vai a 28, e março volta ao 31", async () => {
    const jan = await DespesasService.create(
      {
        description: "Aluguel dia 31",
        amount: 100,
        type: "FIXA",
        status: "PENDENTE",
        dueDate: "2026-01-31",
        recurring: true,
      },
      ctx,
    );
    await DespesasService.marcarComoPago({ id: jan.id }, ctx);
    const fev = await prisma.expense.findFirstOrThrow({ where: { tenantId, parentId: jan.id } });
    expect(civilParts(fev.dueDate!).day).toBe(28);
    await DespesasService.marcarComoPago({ id: fev.id }, ctx);
    const mar = await prisma.expense.findFirstOrThrow({ where: { tenantId, parentId: fev.id } });
    expect(civilParts(mar.dueDate!).day).toBe(31);
  });
});

describe("recálculo de status não grava por cima de quem mudou no meio", () => {
  it("assinatura alterada depois da leitura: a gravação não acontece", async () => {
    const plano = await prisma.plan.create({
      data: {
        name: "Plano status condicional",
        slug: `status-condicional-${randomUUID().slice(0, 8)}`,
        priceMonthly: 50,
        features: { modules: [] },
      },
    });
    const sub = await prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: plano.id,
        status: "ATIVO",
        monthlyAmount: 50,
        currentPeriodEnd: new Date(Date.now() - 86_400_000),
        graceDays: 5,
      },
    });
    // Um chargeback commitou entre a leitura e a gravação do recálculo.
    await prisma.tenantSubscription.update({
      where: { id: sub.id },
      data: { status: "BLOQUEADO", statusSource: "MANUAL" },
    });
    expect(await gravarStatusCalculado(sub, "VENCIDO")).toBe(false);
    const agora = await prisma.tenantSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(agora.status).toBe("BLOQUEADO");
    // Relida, a gravação passa: o recálculo seguinte parte da linha nova.
    expect(await gravarStatusCalculado(agora, "BLOQUEADO")).toBe(true);
    await prisma.tenantSubscription.delete({ where: { id: sub.id } });
    await prisma.plan.delete({ where: { id: plano.id } });
  });
});
