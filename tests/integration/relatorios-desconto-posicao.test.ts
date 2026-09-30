import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { buildReport } from "@/lib/reports/report.service";
import { DashboardService } from "@/lib/services/dashboard.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { resolvePeriod } from "@/lib/dates";
import { addDaysTz, startOfMonthTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Relatórios e painel que liam um número diferente do total vendido, do
 * estoque ou da própria tela.
 */

const tenants: string[] = [];

afterAll(async () => {
  await cleanupTenants(tenants);
});

async function novoTenant(nome: string) {
  const id = await createTestTenant(nome);
  tenants.push(id);
  return id;
}

async function produto(tenantId: string, name: string, recipientType?: "PAPELAO") {
  return prisma.product.create({
    data: { tenantId, name, saleUnit: "CAIXA", recipientType: recipientType ?? null },
  });
}

/** Venda gravada direto, com o desconto da VENDA fora das linhas — como o PDV grava. */
async function venda(
  tenantId: string,
  itens: { productId: string; lineTotal: number; custo: number; qtd?: number }[],
  descontoVenda: number,
  saleDate: Date = new Date(),
) {
  const soma = itens.reduce((a, i) => a + i.lineTotal, 0);
  return prisma.sale.create({
    data: {
      tenantId,
      saleDate,
      paymentMethod: "DINHEIRO",
      subtotalAmount: soma,
      discountAmount: descontoVenda,
      totalAmount: Math.max(0, soma - descontoVenda),
      items: {
        create: itens.map((i) => ({
          tenantId,
          productId: i.productId,
          quantity: i.qtd ?? 1,
          unitPrice: i.lineTotal / (i.qtd ?? 1),
          lineTotal: i.lineTotal,
          unitCostAtSale: i.custo / (i.qtd ?? 1),
        })),
      },
    },
  });
}

const n = (v: unknown) => Number(String(v));

describe("#43 desconto da venda entra na receita por produto", () => {
  let tenantId = "";
  let tomate = "";
  let alface = "";

  beforeAll(async () => {
    tenantId = await novoTenant("DESCONTO");
    tomate = (await produto(tenantId, "Tomate")).id;
    alface = (await produto(tenantId, "Alface")).id;
    // Tomate R$ 60 (custo 50) + Alface R$ 40 (custo 30), desconto de R$ 20:
    // total R$ 80, custo R$ 80 — lucro ZERO, não R$ 20.
    await venda(
      tenantId,
      [
        { productId: tomate, lineTotal: 60, custo: 50 },
        { productId: alface, lineTotal: 40, custo: 30 },
      ],
      20,
    );
  });

  it("'Lucro por produto' fecha com o relatório de vendas", async () => {
    const p = resolvePeriod({ preset: "mes" });
    const [lucro, vendas] = await Promise.all([
      buildReport("LUCRO_PRODUTO", { tenantId, from: p.from, to: p.to }),
      buildReport("VENDAS", { tenantId, from: p.from, to: p.to }),
    ]);
    expect(n(lucro.totals!.receita)).toBe(n(vendas.totals!.totalAmount));
    expect(n(lucro.totals!.receita)).toBe(80);
    expect(n(lucro.totals!.lucro)).toBe(0);

    // Rateio proporcional ao valor da linha: 60/100 e 40/100 dos R$ 20.
    const porNome = Object.fromEntries(lucro.rows.map((r) => [r.name as string, r]));
    expect(n(porNome.Tomate!.receita)).toBe(48);
    expect(n(porNome.Alface!.receita)).toBe(32);
  });

  it("'Com prejuízo' aponta o produto que só deu prejuízo depois do desconto", async () => {
    const p = resolvePeriod({ preset: "mes" });
    const rel = await buildReport("PRODUTOS_PREJUIZO", { tenantId, from: p.from, to: p.to });
    // Tomate: 48 − 50 = −2. Alface: 32 − 30 = +2.
    expect(rel.rows.map((r) => r.name)).toEqual(["Tomate"]);
    expect(n(rel.rows[0]!.prejuizo)).toBe(-2);
  });

  it("'Mais vendidos' e 'Lucro por fornecedor' usam a mesma receita", async () => {
    const p = resolvePeriod({ preset: "mes" });
    const [mais, forn] = await Promise.all([
      buildReport("MAIS_VENDIDOS", { tenantId, from: p.from, to: p.to }),
      buildReport("LUCRO_FORNECEDOR", { tenantId, from: p.from, to: p.to }),
    ]);
    expect(n(mais.totals!.receita)).toBe(80);
    expect(n(forn.totals!.receita)).toBe(80);
  });

  it("painel: listas do mês com o desconto rateado", async () => {
    const painel = await DashboardService.getSummary(tenantId);
    const tom = painel.topLucrativos.find((r) => r.productId === tomate);
    const alf = painel.topLucrativos.find((r) => r.productId === alface);
    expect(n(tom!.profit)).toBe(-2);
    expect(n(alf!.profit)).toBe(2);
    expect(painel.produtosComPrejuizo.map((r) => r.productId)).toEqual([tomate]);
    // E a soma das listas fecha com o lucro bruto do cartão.
    const somaLucro = painel.topLucrativos.reduce((a, r) => a + n(r.profit), 0);
    expect(somaLucro).toBe(n(painel.lucroBrutoMes));
  });
});

describe("#47 lucro por fornecedor inclui produto sem compra registrada", () => {
  it("a venda de produto lançado por ajuste entra em 'Sem fornecedor'", async () => {
    const tenantId = await novoTenant("SEMCOMPRA");
    const prod = await produto(tenantId, "Chuchu");
    await venda(tenantId, [{ productId: prod.id, lineTotal: 500, custo: 300 }], 0);

    const p = resolvePeriod({ preset: "mes" });
    const [forn, lucro] = await Promise.all([
      buildReport("LUCRO_FORNECEDOR", { tenantId, from: p.from, to: p.to }),
      buildReport("LUCRO_PRODUTO", { tenantId, from: p.from, to: p.to }),
    ]);
    expect(forn.rows).toHaveLength(1);
    expect(forn.rows[0]!.supplier).toBe("Sem fornecedor");
    expect(n(forn.totals!.receita)).toBe(n(lucro.totals!.receita));
    expect(n(forn.totals!.lucro)).toBe(200);
  });
});

describe("#48 listas do painel têm o teto 'até agora'", () => {
  it("venda com data futura não entra nas listas do mês", async () => {
    const tenantId = await novoTenant("FUTURA");
    const prod = await produto(tenantId, "Abobrinha");
    await venda(tenantId, [{ productId: prod.id, lineTotal: 100, custo: 10 }], 0, addDaysTz(new Date(), 3));

    const painel = await DashboardService.getSummary(tenantId);
    expect(n(painel.mesVendi)).toBe(0);
    expect(painel.topVendidos).toHaveLength(0);
    expect(painel.topLucrativos).toHaveLength(0);
  });
});

describe("X2 estoque parado usa o valor da tela de Estoque", () => {
  it("custo médio ponderado móvel, não a soma do livro-razão", async () => {
    const tenantId = await novoTenant("PARADO");
    const prod = await produto(tenantId, "Batata");
    const t = (min: number) => new Date(Date.now() - 60 * 24 * 3600_000 + min * 60_000);
    // 10 a R$ 10 e 10 a R$ 20 (média 15), depois saem 10 pela média. Sobram
    // 10 × 15 = R$ 150. A soma com sinal do livro-razão dava 100 + 200 − 0 = 300.
    await prisma.stockMovement.createMany({
      data: [
        { tenantId, productId: prod.id, type: "ENTRADA", quantity: 10, unitCost: 10, movedAt: t(0), createdAt: t(0) },
        { tenantId, productId: prod.id, type: "ENTRADA", quantity: 10, unitCost: 20, movedAt: t(1), createdAt: t(1) },
        { tenantId, productId: prod.id, type: "QUEBRA", quantity: 10, unitCost: null, movedAt: t(2), createdAt: t(2) },
      ],
    });

    const p = resolvePeriod({ preset: "mes" });
    const rel = await buildReport("ESTOQUE_PARADO", { tenantId, from: p.from, to: p.to });
    const posicao = (await EstoqueService.getPositions(tenantId)).find((x) => x.productId === prod.id)!;
    expect(rel.rows).toHaveLength(1);
    expect(n(rel.rows[0]!.value)).toBe(n(posicao.value));
    expect(n(rel.rows[0]!.value)).toBe(150);
    expect(n(rel.totals!.value)).toBe(150);
  });
});

describe("#44 inadimplentes é posição na data de corte", () => {
  it("devedor antigo aparece no preset padrão 'Este mês'", async () => {
    const tenantId = await novoTenant("INADIMPLENTE");
    const antigo = addDaysTz(startOfMonthTz(new Date()), -80);
    // Aberta há ~80 dias, sem vencimento, nunca paga.
    await prisma.creditAccount.create({
      data: {
        tenantId,
        customerName: "Devedor de julho",
        totalAmount: 100,
        paidAmount: 0,
        status: "EM_ABERTO",
        createdAt: antigo,
      },
    });
    // Vencida há 40 dias, aberta antes do mês.
    await prisma.creditAccount.create({
      data: {
        tenantId,
        customerName: "Vencida mês passado",
        totalAmount: 50,
        paidAmount: 10,
        status: "EM_ABERTO",
        dueDate: addDaysTz(new Date(), -40),
        createdAt: addDaysTz(new Date(), -45),
      },
    });

    const p = resolvePeriod({ preset: "mes" });
    const rel = await buildReport("INADIMPLENTES", { tenantId, from: p.from, to: p.to });
    expect(rel.rows.map((r) => r.customerName).sort()).toEqual([
      "Devedor de julho",
      "Vencida mês passado",
    ]);
    expect(n(rel.totals!.saldo)).toBe(140);
    expect(rel.title).toContain("posição em");
  });
});
