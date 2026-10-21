import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { ComprasService } from "@/lib/services/compras.service";
import { VendasService } from "@/lib/services/vendas.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { EstoqueService, custoMedioPonderado } from "@/lib/services/estoque.service";
import { ProdutosService } from "@/lib/services/produtos.service";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { DespesasService } from "@/lib/services/despesas.service";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { FiadoService } from "@/lib/services/fiado.service";
import { buildReport } from "@/lib/reports/report.service";
import { resolvePeriod } from "@/lib/dates";
import { isoDateTz } from "@/lib/tz";
import { COMPRA_EXPENSE_CATEGORY } from "@/lib/constants";
import type { CompraInput } from "@/lib/validations/compra";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Desfazer lançamento — a regra única (`src/lib/desfazer/prazo.ts`) para
 * compra e recebimento de fiado, que antes não tinham volta — e as pontas que
 * deixavam valor sumir sem registro: produto excluído com saldo, fornecedor
 * excluído com conta a pagar, embalagem fora do resultado e higienização com
 * duas datas no mesmo painel.
 */

const tenants: string[] = [];
let tenantId = "";
let ctx = makeCtx("");
let productId = "";
let supplierId = "";
const hoje = isoDateTz();

beforeAll(async () => {
  tenantId = await createTestTenant("DESFAZER LANCAMENTOS");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  const db = getTenantPrisma(tenantId);
  await prisma.expenseCategory.create({
    data: { tenantId, name: COMPRA_EXPENSE_CATEGORY, isDefault: true },
  });
  productId = (await db.product.create({ data: { tenantId, name: "Tomate", saleUnit: "CAIXA" } }))
    .id;
  supplierId = (await db.supplier.create({ data: { tenantId, name: "Sítio Boa Vista" } })).id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

beforeEach(async () => {
  await prisma.plasticCrateMovement.deleteMany({ where: { tenantId } });
  await prisma.creditPayment.deleteMany({ where: { tenantId } });
  await prisma.creditAccount.deleteMany({ where: { tenantId } });
  await prisma.salePayment.deleteMany({ where: { tenantId } });
  await prisma.saleItem.deleteMany({ where: { tenantId } });
  await prisma.sale.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.stockMovement.deleteMany({ where: { tenantId } });
  await prisma.purchaseItem.deleteMany({ where: { tenantId } });
  await prisma.purchase.deleteMany({ where: { tenantId } });
});

function compra(extra: Partial<CompraInput> = {}): CompraInput {
  return {
    supplierId,
    purchaseDate: hoje,
    freight: 0,
    items: [{ productId, quantity: 10, unitPrice: 5 }],
    pagamento: { status: "PENDENTE", dueDate: hoje },
    ...extra,
  };
}

const saldo = () => EstoqueService.getQuantity(tenantId, productId);
const custo = async () => (await custoMedioPonderado(prisma, tenantId, [productId])).get(productId);

describe("Cancelar compra lançada errada", () => {
  it("tira a mercadoria do estoque, cancela a conta e some dos totais — mas fica na lista", async () => {
    const p = await ComprasService.registrarCompra(compra(), ctx);
    const antesDash = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    expect(Number(antesDash.totalCompradoMes)).toBe(50);

    const r = await ComprasService.cancelarCompra({ id: p.id, motivo: "quantidade errada" }, ctx);
    expect(r.contaCancelada).toBe(true);

    expect(Number(await saldo())).toBe(0);
    const conta = await prisma.expense.findFirstOrThrow({ where: { purchaseId: p.id } });
    expect(conta.deletedAt).toBeTruthy();
    const depoisDash = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    expect(Number(depoisDash.totalCompradoMes)).toBe(0);
    expect(Number(depoisDash.contasPagar)).toBe(0);

    const lista = await ComprasService.list(tenantId);
    const naLista = lista.find((c) => c.id === p.id)!;
    expect(naLista.cancelledAt).toBeTruthy();
    expect(naLista.cancelledReason).toBe("quantidade errada");
    expect(ComprasService.podeCancelar(naLista)).toBe(false);

    const periodo = resolvePeriod({ preset: "hoje" });
    const rel = await buildReport("COMPRAS", { tenantId, from: periodo.from, to: periodo.to });
    expect(rel.rows).toHaveLength(0);
    expect(await ComprasService.ultimaCompraPorProduto(tenantId)).toHaveLength(0);

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, entity: "Purchase", entityId: p.id, action: "PURCHASE_CANCELLED" },
    });
    expect(log).toBeTruthy();
  });

  it("o preço digitado errado sai do custo médio — não fica misturado", async () => {
    await ComprasService.registrarCompra(compra({ items: [{ productId, quantity: 10, unitPrice: 5 }] }), ctx);
    // R$ 500 em vez de R$ 5,00.
    const errada = await ComprasService.registrarCompra(
      compra({ items: [{ productId, quantity: 10, unitPrice: 500 }] }),
      ctx,
    );
    expect(Number(await custo()).toFixed(2)).toBe("252.50");

    await ComprasService.cancelarCompra({ id: errada.id }, ctx);
    // Um estorno comum (saída pela média) deixaria R$ 252,50.
    expect(Number(await custo()).toFixed(2)).toBe("5.00");
    expect(Number(await saldo())).toBe(10);
    expect(Number(await EstoqueService.getTotalValue(tenantId))).toBe(50);

    // A venda seguinte sai pelo custo certo.
    const venda = await VendasService.registrarVenda(
      { paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1, unitPrice: 9 }] },
      ctx,
    );
    expect(Number(venda.items[0]!.unitCostAtSale).toFixed(2)).toBe("5.00");
  });

  it("o livro-razão guarda a entrada e o estorno — nada é apagado", async () => {
    const p = await ComprasService.registrarCompra(compra(), ctx);
    await ComprasService.cancelarCompra({ id: p.id }, ctx);
    const movs = await prisma.stockMovement.findMany({
      where: { tenantId, sourceId: p.id },
      select: { sourceType: true, type: true, quantity: true },
    });
    expect(movs.map((m) => [m.sourceType, m.type, Number(m.quantity)]).sort()).toEqual([
      ["PURCHASE", "ENTRADA", 10],
      ["PURCHASE_CANCELLED", "AJUSTE", -10],
    ]);
  });

  it("conta já PAGA: o pagamento da compra errada sai do fluxo de caixa", async () => {
    const p = await ComprasService.registrarCompra(compra({ pagamento: { status: "PAGO" } }), ctx);
    await ComprasService.cancelarCompra({ id: p.id }, ctx);
    const periodo = resolvePeriod({ preset: "hoje" });
    const rel = await buildReport("FLUXO_CAIXA", { tenantId, from: periodo.from, to: periodo.to });
    const saidas = rel.rows.reduce((a, r) => a + Number((r.saidas as { toString(): string }).toString()), 0);
    expect(saidas).toBe(0);
  });

  it("RECUSA se parte da mercadoria já foi vendida — e nada muda", async () => {
    const p = await ComprasService.registrarCompra(compra(), ctx);
    await VendasService.registrarVenda(
      { paymentMethod: "DINHEIRO", items: [{ productId, quantity: 3, unitPrice: 9 }] },
      ctx,
    );
    await expect(ComprasService.cancelarCompra({ id: p.id }, ctx)).rejects.toThrow(/já houve venda/);
    const depois = await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } });
    expect(depois.cancelledAt).toBeNull();
    expect(Number(await saldo())).toBe(7);
    const conta = await prisma.expense.findFirstOrThrow({ where: { purchaseId: p.id } });
    expect(conta.deletedAt).toBeNull();
  });

  it("RECUSA com estoque de antes se houve venda depois da compra — o CMV dela já levou o preço errado", async () => {
    // Saldo total (15) cobre a compra (10), mas a venda de 5 gravou o custo
    // médio de R$ 252,50; tirar a compra do repasse deixaria esse CMV errado.
    await ComprasService.registrarCompra(compra({ items: [{ productId, quantity: 10, unitPrice: 5 }] }), ctx);
    const errada = await ComprasService.registrarCompra(
      compra({ items: [{ productId, quantity: 10, unitPrice: 500 }] }),
      ctx,
    );
    await VendasService.registrarVenda(
      { paymentMethod: "DINHEIRO", items: [{ productId, quantity: 5, unitPrice: 600 }] },
      ctx,
    );
    await expect(ComprasService.cancelarCompra({ id: errada.id }, ctx)).rejects.toThrow(
      /já houve venda/,
    );
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: errada.id } })).cancelledAt).toBeNull();
  });

  it("compra seguinte de outro fornecedor não impede o cancelamento — só saída ou ajuste", async () => {
    const errada = await ComprasService.registrarCompra(compra(), ctx);
    await ComprasService.registrarCompra(compra({ items: [{ productId, quantity: 4, unitPrice: 6 }] }), ctx);
    await ComprasService.cancelarCompra({ id: errada.id }, ctx);
    expect(Number(await saldo())).toBe(4);
    expect(Number(await custo()).toFixed(2)).toBe("6.00");
  });

  it("total da compra é a soma dos itens arredondados", async () => {
    const p = await ComprasService.registrarCompra(
      compra({
        items: [
          { productId, quantity: 1.115, unitPrice: 1 },
          { productId, quantity: 1.115, unitPrice: 1 },
        ],
      }),
      ctx,
    );
    expect(p.items.map((i) => i.lineTotal.toString())).toEqual(["1.12", "1.12"]);
    expect(p.totalAmount.toString()).toBe("2.24");
  });

  it("RECUSA depois de 24 h e recusa cancelar duas vezes", async () => {
    const velha = await ComprasService.registrarCompra(compra(), ctx);
    await prisma.purchase.update({
      where: { id: velha.id },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await expect(ComprasService.cancelarCompra({ id: velha.id }, ctx)).rejects.toThrow(/prazo/);

    const p = await ComprasService.registrarCompra(compra(), ctx);
    await ComprasService.cancelarCompra({ id: p.id }, ctx);
    await expect(ComprasService.cancelarCompra({ id: p.id }, ctx)).rejects.toThrow(/já foi cancelada/);
    expect(Number(await saldo())).toBe(10); // a velha continua; a nova saiu uma vez só
  });

  it("só o dono cancela — e o super-admin, no ambiente próprio dele", async () => {
    const p = await ComprasService.registrarCompra(compra(), ctx);
    // Papel que não é dono (não existe hoje; é a porta que tem de ficar fechada).
    const outro = { ...ctx, session: { ...ctx.session, role: "STAFF" as never } };
    await expect(ComprasService.cancelarCompra({ id: p.id }, outro)).rejects.toThrow(/responsável/);

    // A sessão do super-admin só carrega o tenant do AMBIENTE dele (`requireTenant`).
    const admin = { ...ctx, session: { ...ctx.session, role: "SUPER_ADMIN" as const } };
    const r = await ComprasService.cancelarCompra({ id: p.id }, admin);
    expect(r.contaCancelada).toBe(true);
  });

  it("estorna as caixas plásticas que chegaram com a compra", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    const p = await ComprasService.registrarCompra(
      compra({ caixasRecebidas: 30, caixasQuebradas: 4 }),
      ctx,
    );
    const naCompra = await CaixasService.getSaldo(tenantId);
    expect(naCompra.limpas).toBe(antes.limpas + 26);
    expect(naCompra.perdidas).toBe(antes.perdidas + 4);

    const r = await ComprasService.cancelarCompra({ id: p.id }, ctx);
    expect(r.caixasEstornadas).toBe(30);
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois).toEqual(antes);
  });

  it("RECUSA se as caixas da compra já saíram do box", async () => {
    const p = await ComprasService.registrarCompra(compra({ caixasRecebidas: 10 }), ctx);
    await CaixasService.registrar(
      { type: "SAIDA", quantity: 8, customerName: "João", movementDate: hoje },
      ctx,
    );
    await expect(ComprasService.cancelarCompra({ id: p.id }, ctx)).rejects.toThrow(/caixas/i);
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } })).cancelledAt).toBeNull();
  });
});

describe("Excluir produto e fornecedor sem sumir com valor", () => {
  it("produto com estoque: recusa; com o estoque zerado: exclui", async () => {
    const db = getTenantPrisma(tenantId);
    const p = await db.product.create({ data: { tenantId, name: "Pepino", saleUnit: "CAIXA" } });
    await prisma.stockMovement.create({
      data: { tenantId, productId: p.id, type: "ENTRADA", quantity: 5, unitCost: 3 },
    });
    await expect(ProdutosService.remove(p.id, ctx)).rejects.toThrow(/ainda tem 5/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).toBeNull();

    await EstoqueService.registrarAjuste({ productId: p.id, type: "QUEBRA", quantity: 5 }, ctx);
    await ProdutosService.remove(p.id, ctx);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).toBeTruthy();
  });

  it("produto vendido nas últimas 24 h: recusa — a venda ainda pode voltar ao estoque", async () => {
    const db = getTenantPrisma(tenantId);
    const p = await db.product.create({ data: { tenantId, name: "Jiló", saleUnit: "CAIXA" } });
    await prisma.stockMovement.create({
      data: { tenantId, productId: p.id, type: "ENTRADA", quantity: 2, unitCost: 3 },
    });
    await VendasService.registrarVenda(
      { paymentMethod: "DINHEIRO", items: [{ productId: p.id, quantity: 2, unitPrice: 5 }] },
      ctx,
    );
    await expect(ProdutosService.remove(p.id, ctx)).rejects.toThrow(/ainda pode ser cancelada/);
  });

  it("fornecedor com conta a pagar: recusa; depois de pagar: exclui", async () => {
    const db = getTenantPrisma(tenantId);
    const f = await db.supplier.create({ data: { tenantId, name: "Fazenda Nova" } });
    const p = await ComprasService.registrarCompra(compra({ supplierId: f.id }), ctx);
    await expect(FornecedoresService.remove(f.id, ctx)).rejects.toThrow(/conta\(s\) a pagar/);

    const conta = await prisma.expense.findFirstOrThrow({ where: { purchaseId: p.id } });
    await DespesasService.marcarComoPago({ id: conta.id, paidDate: hoje }, ctx);
    await FornecedoresService.remove(f.id, ctx);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: f.id } })).deletedAt).toBeTruthy();
  });
});

describe("Resultado do mês no Início", () => {
  it("a Visão Geral mostra o MESMO 'Sobrou no mês' que o Financeiro", async () => {
    await ComprasService.registrarCompra(compra({ items: [{ productId, quantity: 10, unitPrice: 5 }] }), ctx);
    await VendasService.registrarVenda(
      { paymentMethod: "DINHEIRO", items: [{ productId, quantity: 4, unitPrice: 9 }] },
      ctx,
    );
    const geral = await DashboardService.getSummary(tenantId, ctx.session.modules, "geral");
    const fin = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    // Vendi 36, custo 20: o lucro nunca é o próprio "Vendi".
    expect(Number(geral.lucroMes)).toBe(16);
    expect(geral.lucroMes.toString()).toBe(fin.lucroMes.toString());
  });

  it("venda de embalagem entra no lucro e no '% do que você vendeu'", async () => {
    const tipo = await getTenantPrisma(tenantId).packagingType.create({
      data: { tenantId, name: `Papelão ${Date.now()}` },
    });
    const antes = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    const antesDespesas = await DespesasService.resumoMes(tenantId, undefined, new Date(), ctx.session.modules);
    await EmbalagensService.createSale(
      { packagingTypeId: tipo.id, saleDate: hoje, quantity: 10, unitPrice: 1.5 },
      ctx,
    );
    const depois = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    const depoisDespesas = await DespesasService.resumoMes(tenantId, undefined, new Date(), ctx.session.modules);

    expect(Number(depois.embalagensMes) - Number(antes.embalagensMes)).toBe(15);
    expect(Number(depois.lucroMes) - Number(antes.lucroMes)).toBe(15);
    // "Vendi" continua sendo a venda de mercadoria (o histórico de vendas).
    expect(depois.mesVendi.toString()).toBe(antes.mesVendi.toString());
    expect(Number(depoisDespesas.faturamento) - Number(antesDespesas.faturamento)).toBe(15);
  });
});

describe("Baixar fiado como perda", () => {
  async function fiado(total: number) {
    await ComprasService.registrarCompra(compra({ items: [{ productId, quantity: 10, unitPrice: 5 }] }), ctx);
    const venda = await VendasService.registrarVenda(
      {
        customerName: "Cliente que sumiu",
        paymentMethod: "FIADO",
        items: [{ productId, quantity: 2, unitPrice: total / 2 }],
      },
      ctx,
    );
    return prisma.creditAccount.findFirstOrThrow({ where: { saleId: venda.id } });
  }

  it("tira o saldo do 'a receber' e desconta a perda no resultado do mês da baixa", async () => {
    const conta = await fiado(40);
    await FiadoService.registrarPagamento({ accountId: conta.id, amount: 10, method: "PIX" }, ctx);
    const antes = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");

    const baixada = await FiadoService.baixarComoPerda({ id: conta.id, motivo: "fechou o box" }, ctx);
    expect(baixada.status).toBe("PERDA");
    expect(Number(baixada.writtenOffAmount)).toBe(30);

    const depois = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    expect(Number(depois.perdasFiadoMes) - Number(antes.perdasFiadoMes)).toBe(30);
    expect(Number(antes.lucroMes) - Number(depois.lucroMes)).toBe(30);
    expect(Number(antes.aReceber) - Number(depois.aReceber)).toBe(30);
    // A venda continua faturamento: a mercadoria saiu.
    expect(depois.mesVendi.toString()).toBe(antes.mesVendi.toString());
  });

  it("cliente pagou depois da baixa: entra no resultado do mês do recebimento, a perda fica", async () => {
    const conta = await fiado(20);
    await FiadoService.baixarComoPerda({ id: conta.id, motivo: "sumiu" }, ctx);
    const antes = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");

    const parcial = await FiadoService.registrarPagamento(
      { accountId: conta.id, amount: 5, method: "PIX" },
      ctx,
    );
    expect(parcial.status).toBe("PERDA");
    const meio = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    expect(Number(meio.recuperadoFiadoMes) - Number(antes.recuperadoFiadoMes)).toBe(5);
    expect(Number(meio.lucroMes) - Number(antes.lucroMes)).toBe(5);

    const quitada = await FiadoService.registrarPagamento(
      { accountId: conta.id, amount: 15, method: "DINHEIRO" },
      ctx,
    );
    expect(quitada.status).toBe("PAGO");
    const depois = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    // A perda continua lançada (é a data da baixa que manda), e a recuperação soma.
    expect(depois.perdasFiadoMes.toString()).toBe(antes.perdasFiadoMes.toString());
    expect(Number(depois.lucroMes) - Number(antes.lucroMes)).toBe(20);
  });

  it("depois da baixa: só o recebimento de DEPOIS é estornável; a venda não é cancelada", async () => {
    const conta = await fiado(20);
    await FiadoService.registrarPagamento({ accountId: conta.id, amount: 5, method: "PIX" }, ctx);
    await FiadoService.baixarComoPerda({ id: conta.id, motivo: "não vai pagar" }, ctx);
    const antesDaBaixa = await prisma.creditPayment.findFirstOrThrow({
      where: { accountId: conta.id, aposBaixa: false },
    });
    await expect(
      FiadoService.estornarPagamento({ paymentId: antesDaBaixa.id }, ctx),
    ).rejects.toThrow(/perda/i);
    await expect(
      VendasService.cancelarVenda({ id: conta.saleId!, motivo: null }, ctx),
    ).rejects.toThrow();

    await FiadoService.registrarPagamento({ accountId: conta.id, amount: 3, method: "PIX" }, ctx);
    const depoisDaBaixa = await prisma.creditPayment.findFirstOrThrow({
      where: { accountId: conta.id, aposBaixa: true },
    });
    // Com recebimento depois da baixa, desfazer a baixa pede o estorno antes.
    await expect(FiadoService.desfazerBaixa({ id: conta.id }, ctx)).rejects.toThrow(/estorne/i);
    const estornada = await FiadoService.estornarPagamento({ paymentId: depoisDaBaixa.id }, ctx);
    expect(estornada.status).toBe("PERDA");
  });

  it("desfaz em até 24 h; depois disso, não", async () => {
    const conta = await fiado(20);
    await FiadoService.baixarComoPerda({ id: conta.id, motivo: "engano" }, ctx);
    const reaberta = await FiadoService.desfazerBaixa({ id: conta.id }, ctx);
    expect(reaberta.status).toBe("EM_ABERTO");
    expect(reaberta.writtenOffAmount).toBeNull();

    await FiadoService.baixarComoPerda({ id: conta.id, motivo: "agora é verdade" }, ctx);
    await prisma.creditAccount.update({
      where: { id: conta.id },
      data: { writtenOffAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await expect(FiadoService.desfazerBaixa({ id: conta.id }, ctx)).rejects.toThrow(/prazo/i);
  });

  it("recusa baixar conta quitada e baixar duas vezes", async () => {
    const conta = await fiado(10);
    await FiadoService.registrarPagamento({ accountId: conta.id, amount: 10, method: "DINHEIRO" }, ctx);
    await expect(
      FiadoService.baixarComoPerda({ id: conta.id, motivo: "teste" }, ctx),
    ).rejects.toThrow(/saldo/i);

    const outra = await fiado(10);
    await FiadoService.baixarComoPerda({ id: outra.id, motivo: "teste" }, ctx);
    await expect(
      FiadoService.baixarComoPerda({ id: outra.id, motivo: "teste" }, ctx),
    ).rejects.toThrow(/já foi baixado/i);
  });
});

describe("Custo da embalagem vendida no resultado do mês", () => {
  it("o lucro sobe pela venda MENOS o custo médio da embalagem", async () => {
    const tipo = await getTenantPrisma(tenantId).packagingType.create({
      data: { tenantId, name: `Sacaria ${Date.now()}` },
    });
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 20, custoUnitario: 0.5 },
      ctx,
    );
    const antes = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");
    await EmbalagensService.createSale(
      { packagingTypeId: tipo.id, saleDate: hoje, quantity: 10, unitPrice: 1.5 },
      ctx,
    );
    const depois = await DashboardService.getSummary(tenantId, ctx.session.modules, "financeiro");

    expect(Number(depois.embalagensMes) - Number(antes.embalagensMes)).toBe(15);
    expect(Number(depois.custoEmbalagensMes) - Number(antes.custoEmbalagensMes)).toBe(5);
    expect(Number(depois.lucroMes) - Number(antes.lucroMes)).toBe(10);
  });
});
