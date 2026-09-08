import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { EstoqueService, custoMedioPonderado } from "@/lib/services/estoque.service";
import { ComprasService } from "@/lib/services/compras.service";
import { VendasService } from "@/lib/services/vendas.service";
import { ProdutosService } from "@/lib/services/produtos.service";
import { isoDateTz } from "@/lib/tz";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * Custo médio, valor de estoque e ajuste manual.
 *
 * Três defeitos que compartilham o mesmo arquivo e a mesma consequência: número
 * errado onde o dono do box decide preço.
 */

const tenants: string[] = [];
let tenantId = "";
let productId = "";
let ctx = makeCtx("");
const hoje = isoDateTz();

beforeAll(async () => {
  tenantId = await createTestTenant("CUSTO");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  const p = await getTenantPrisma(tenantId).product.create({
    data: { tenantId, name: "Tomate", saleUnit: "CAIXA" },
  });
  productId = p.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

beforeEach(async () => {
  await prisma.saleItem.deleteMany({ where: { tenantId } });
  await prisma.salePayment.deleteMany({ where: { tenantId } });
  await prisma.sale.deleteMany({ where: { tenantId } });
  await prisma.stockMovement.deleteMany({ where: { tenantId } });
  await prisma.purchaseItem.deleteMany({ where: { tenantId } });
  await prisma.purchase.deleteMany({ where: { tenantId } });
});

/** Duas compras de preço muito diferente e volume muito diferente. */
async function comprasDesbalanceadas() {
  await ComprasService.registrarCompra(
    {
      supplierId: null,
      purchaseDate: hoje,
      freight: 0,
      items: [{ productId, quantity: 100, unitPrice: 1 }],
    },
    ctx,
  );
  await ComprasService.registrarCompra(
    {
      supplierId: null,
      purchaseDate: hoje,
      freight: 0,
      items: [{ productId, quantity: 1, unitPrice: 100 }],
    },
    ctx,
  );
}

describe("custo médio é PONDERADO pela quantidade (regressão)", () => {
  // 100 caixas a R$ 1,00 + 1 caixa a R$ 100,00.
  //   ponderado  = (100×1 + 1×100) / 101 = R$ 1,98
  //   aritmético = (1 + 100) / 2         = R$ 50,50   ← o que o sistema fazia
  it("a fórmula devolve 1,98 e não 50,50", async () => {
    await comprasDesbalanceadas();
    const custos = await custoMedioPonderado(prisma, tenantId, [productId]);
    expect(Number(custos.get(productId)).toFixed(2)).toBe("1.98");
  });

  it("a tela de estoque mostra o ponderado", async () => {
    await comprasDesbalanceadas();
    const posicao = (await EstoqueService.getPositions(tenantId)).find(
      (p) => p.productId === productId,
    )!;
    expect(posicao.avgCost.toFixed(2)).toBe("1.98");
  });

  // O estrago real: este valor é gravado na venda e vira a base do lucro.
  it("a venda grava o custo ponderado em unitCostAtSale", async () => {
    await comprasDesbalanceadas();
    const venda = await VendasService.registrarVenda(
      { paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1, unitPrice: 30 }] },
      ctx,
    );
    // Com o custo aritmético (50,50), vender a R$ 30 aparecia como prejuízo de
    // R$ 20,50. Com o ponderado, é lucro de R$ 28,02.
    expect(Number(venda.items[0]!.unitCostAtSale).toFixed(2)).toBe("1.98");
    const lucro = 30 - Number(venda.items[0]!.unitCostAtSale);
    expect(lucro).toBeGreaterThan(0);
    expect(lucro.toFixed(2)).toBe("28.02");
  });
});

describe("valor de estoque não conta produto excluído (regressão)", () => {
  it("o painel e a tela de estoque passam a dar o MESMO número", async () => {
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: hoje,
        freight: 0,
        items: [{ productId, quantity: 10, unitPrice: 10 }],
      },
      ctx,
    );
    const outro = await getTenantPrisma(tenantId).product.create({
      data: { tenantId, name: "Cebola", saleUnit: "CAIXA" },
    });
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: hoje,
        freight: 0,
        items: [{ productId: outro.id, quantity: 10, unitPrice: 10 }],
      },
      ctx,
    );

    const antes = Number(await EstoqueService.getTotalValue(tenantId));
    expect(antes).toBe(200);

    await ProdutosService.remove(outro.id, ctx);

    // `getPositions` sempre filtrou produto excluído; `getTotalValue` não. Um
    // produto de R$ 100 sumia da tela de Estoque e continuava no painel.
    const somaDaTela = (await EstoqueService.getPositions(tenantId)).reduce(
      (a, p) => a + Number(p.value),
      0,
    );
    const doPainel = Number(await EstoqueService.getTotalValue(tenantId));
    expect(doPainel).toBe(100);
    expect(doPainel).toBe(somaDaTela);
  });
});

describe("ajuste manual não leva o estoque a negativo (regressão)", () => {
  beforeEach(async () => {
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: hoje,
        freight: 0,
        items: [{ productId, quantity: 10, unitPrice: 5 }],
      },
      ctx,
    );
  });

  it("recusa quebra maior que o saldo", async () => {
    // Não havia validação nenhuma: o saldo virava −999989, o valor de estoque
    // ficava negativo no painel e o PDV passava a recusar toda venda do produto.
    await expect(
      EstoqueService.registrarAjuste(
        { productId, type: "QUEBRA", quantity: 999999 },
        ctx,
      ),
    ).rejects.toThrow(/estoque/i);
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(10);
  });

  it("recusa doação maior que o saldo", async () => {
    await expect(
      EstoqueService.registrarAjuste({ productId, type: "DOACAO", quantity: 11 }, ctx),
    ).rejects.toThrow(/estoque/i);
  });

  it("aceita quebra dentro do saldo", async () => {
    await EstoqueService.registrarAjuste({ productId, type: "QUEBRA", quantity: 4 }, ctx);
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(6);
  });

  // Antes, `AJUSTE` só somava: quem contava a prateleira e achava MENOS do que o
  // sistema dizia só podia lançar "quebra", o que mente sobre o motivo.
  it("aceita acerto de inventário para baixo, com AJUSTE negativo", async () => {
    await EstoqueService.registrarAjuste({ productId, type: "AJUSTE", quantity: -3 }, ctx);
    expect(Number(await EstoqueService.getQuantity(tenantId, productId))).toBe(7);
  });

  it("recusa acerto para baixo maior que o saldo", async () => {
    await expect(
      EstoqueService.registrarAjuste({ productId, type: "AJUSTE", quantity: -50 }, ctx),
    ).rejects.toThrow(/estoque/i);
  });

  it("o custo do ajuste sai do médio PONDERADO quando não é informado", async () => {
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: hoje,
        freight: 0,
        items: [{ productId, quantity: 1, unitPrice: 100 }],
      },
      ctx,
    );
    // 10 a R$ 5 + 1 a R$ 100 → ponderado (10×5 + 100)/11 = 13,64 (aritmético: 52,50)
    const mov = await EstoqueService.registrarAjuste(
      { productId, type: "QUEBRA", quantity: 1 },
      ctx,
    );
    expect(Number(mov.unitCost).toFixed(2)).toBe("13.64");
  });
});
