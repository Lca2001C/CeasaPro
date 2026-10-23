import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { buildReport } from "@/lib/reports/report.service";
import { buildComprovanteVenda } from "@/lib/reports/comprovante-venda";
import { resolvePeriod } from "@/lib/dates";
import { add } from "@/lib/money";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Relatório de vendas por cliente (o extrato, com os itens de cada venda) e o
 * comprovante de uma venda.
 *
 * O cliente é a identidade do nome (`chaveDoCliente`): "João" e " joão " são
 * a mesma pessoa, como na aba Clientes e no fiado.
 */

const tenants: string[] = [];
let tenantId = "";
let outraEmpresa = "";
let tomate = "";
let alface = "";

afterAll(async () => {
  await cleanupTenants(tenants);
});

async function novoTenant(nome: string) {
  const id = await createTestTenant(nome);
  tenants.push(id);
  return id;
}

/** Venda gravada direto, com o desconto da VENDA fora das linhas — como o PDV grava. */
async function venda(
  tenant: string,
  cliente: string | null,
  itens: { productId: string; qtd: number; preco: number; descontoLinha?: number }[],
  extra: {
    descontoVenda?: number;
    motivo?: string;
    cancelada?: boolean;
    pagamentos?: { method: "DINHEIRO" | "PIX"; amount: number }[];
    pagouCom?: number;
  } = {},
) {
  const linhas = itens.map((i) => ({ ...i, total: i.qtd * i.preco - (i.descontoLinha ?? 0) }));
  const subtotal = linhas.reduce((a, i) => a + i.total, 0);
  const desconto = extra.descontoVenda ?? 0;
  const total = subtotal - desconto;
  return prisma.sale.create({
    data: {
      tenantId: tenant,
      customerName: cliente,
      saleDate: new Date(),
      paymentMethod: "DINHEIRO",
      subtotalAmount: subtotal,
      discountAmount: desconto,
      discountReason: extra.motivo ?? null,
      totalAmount: total,
      amountReceived: extra.pagouCom ?? null,
      changeGiven: extra.pagouCom ? extra.pagouCom - total : null,
      cancelledAt: extra.cancelada ? new Date() : null,
      items: {
        create: linhas.map((i) => ({
          tenantId: tenant,
          productId: i.productId,
          quantity: i.qtd,
          unitPrice: i.preco,
          discountAmount: i.descontoLinha ?? 0,
          lineTotal: i.total,
          unitCostAtSale: 1,
        })),
      },
      ...(extra.pagamentos
        ? { payments: { create: extra.pagamentos.map((p) => ({ tenantId: tenant, ...p })) } }
        : {}),
    },
  });
}

const n = (v: unknown) => Number(String(v));
const mes = () => resolvePeriod({ preset: "mes" });

beforeAll(async () => {
  tenantId = await novoTenant("RELATORIO CLIENTE");
  outraEmpresa = await novoTenant("RELATORIO CLIENTE OUTRA");
  tomate = (await prisma.product.create({ data: { tenantId, name: "Tomate", saleUnit: "CAIXA" } })).id;
  alface = (await prisma.product.create({ data: { tenantId, name: "Alface", saleUnit: "UNIDADE" } })).id;
  const tomateOutra = (
    await prisma.product.create({ data: { tenantId: outraEmpresa, name: "Tomate", saleUnit: "CAIXA" } })
  ).id;

  // João, com duas grafias: 2 × 30 + 4 × 5 = 80, desconto da venda de 10 → 70.
  await venda(tenantId, "João", [
    { productId: tomate, qtd: 2, preco: 30 },
    { productId: alface, qtd: 4, preco: 5 },
  ], { descontoVenda: 10, motivo: "freguês antigo" });
  // " joão ": 1 × 30 com 5 de desconto na linha → 25.
  await venda(tenantId, " joão ", [{ productId: tomate, qtd: 1, preco: 30, descontoLinha: 5 }]);
  // Cancelada e de outro cliente: fora do extrato.
  await venda(tenantId, "João", [{ productId: tomate, qtd: 10, preco: 30 }], { cancelada: true });
  await venda(tenantId, "Maria", [{ productId: alface, qtd: 1, preco: 5 }]);
  // Mesmo nome em OUTRA empresa: não entra.
  await venda(outraEmpresa, "João", [{ productId: tomateOutra, qtd: 3, preco: 30 }]);
});

describe("extrato do cliente no relatório de vendas", () => {
  it("junta as grafias do mesmo cliente e deixa de fora cancelada, outro cliente e outra empresa", async () => {
    const p = mes();
    const r = await buildReport("VENDAS", { tenantId, from: p.from, to: p.to, cliente: "JOÃO" });

    // A grafia é a da venda mais recente; aqui as duas têm o mesmo horário.
    expect(r.title).toMatch(/^Vendas de jo[aã]o$/i);
    // 2 itens + desconto da venda + 1 item.
    expect(r.rows).toHaveLength(4);
    expect(n(r.totals!.lineTotal)).toBe(95);
  });

  it("as linhas de cada venda somam o total dela (itens + desconto da venda)", async () => {
    const p = mes();
    const r = await buildReport("VENDAS", { tenantId, from: p.from, to: p.to, cliente: "joão" });
    const soma = add(...r.rows.map((l) => l.lineTotal as never));
    expect(n(soma)).toBe(n(r.totals!.lineTotal));
    const desconto = r.rows.find((l) => String(l.product).startsWith("Desconto da venda"));
    expect(n(desconto!.lineTotal)).toBe(-10);
    expect(desconto!.product).toBe("Desconto da venda (freguês antigo)");
  });

  it("cliente sem venda no período devolve o extrato vazio", async () => {
    const p = mes();
    const r = await buildReport("VENDAS", { tenantId, from: p.from, to: p.to, cliente: "Ninguém" });
    expect(r.rows).toHaveLength(0);
  });

  it("sem cliente, o relatório de vendas continua uma linha por venda", async () => {
    const p = mes();
    const r = await buildReport("VENDAS", { tenantId, from: p.from, to: p.to });
    expect(r.columns.map((c) => c.key)).toEqual([
      "saleDate",
      "customerName",
      "paymentMethod",
      "totalAmount",
    ]);
    // João (70) + joão (25) + Maria (5); a cancelada fica de fora.
    expect(r.rows).toHaveLength(3);
    expect(n(r.totals!.totalAmount)).toBe(100);
  });
});

describe("comprovante de uma venda", () => {
  it("traz cliente, pagamentos, troco e itens; as linhas fecham com o total", async () => {
    const v = await venda(
      tenantId,
      "Zé do Box",
      [{ productId: tomate, qtd: 2, preco: 30 }],
      {
        descontoVenda: 5,
        pagamentos: [
          { method: "DINHEIRO", amount: 35 },
          { method: "PIX", amount: 20 },
        ],
        pagouCom: 55,
      },
    );
    const r = await buildComprovanteVenda(tenantId, v.id);

    const cab = Object.fromEntries(r.cabecalho!.map((l) => [l.rotulo, l.valor]));
    expect(cab.Cliente).toBe("Zé do Box");
    expect(cab.Pagamento).toContain("Dinheiro");
    expect(cab.Pagamento).toContain("PIX");
    expect(cab.Troco).toBeDefined();
    expect(cab["Situação"]).toBeUndefined();
    expect(n(r.totals!.lineTotal)).toBe(55);
    expect(n(add(...r.rows.map((l) => l.lineTotal as never)))).toBe(55);
  });

  it("venda cancelada sai marcada", async () => {
    const v = await venda(tenantId, "Cancelado", [{ productId: alface, qtd: 1, preco: 5 }], {
      cancelada: true,
    });
    const r = await buildComprovanteVenda(tenantId, v.id);
    const situacao = r.cabecalho!.find((l) => l.rotulo === "Situação");
    expect(situacao?.valor).toMatch(/^CANCELADA em/);
  });

  it("venda de outra empresa não é encontrada", async () => {
    const daOutra = await prisma.sale.findFirstOrThrow({ where: { tenantId: outraEmpresa } });
    await expect(buildComprovanteVenda(tenantId, daOutra.id)).rejects.toThrow(/não encontrada/);
  });
});
