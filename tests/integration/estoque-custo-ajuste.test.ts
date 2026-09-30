import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
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

/** Compra de uma linha só, sem frete. */
async function comprar(quantity: number, unitPrice: number) {
  return ComprasService.registrarCompra(
    { supplierId: null, purchaseDate: hoje, freight: 0, items: [{ productId, quantity, unitPrice }] },
    ctx,
  );
}

async function vender(quantity: number, unitPrice: number) {
  return VendasService.registrarVenda(
    { paymentMethod: "DINHEIRO", items: [{ productId, quantity, unitPrice }] },
    ctx,
  );
}

async function custoAtual() {
  const custos = await custoMedioPonderado(prisma, tenantId, [productId]);
  return custos.get(productId);
}

async function posicao() {
  return (await EstoqueService.getPositions(tenantId)).find((p) => p.productId === productId)!;
}

describe("custo médio é do estoque ATUAL, não do histórico inteiro (regressão)", () => {
  // O cenário da auditoria. Julho: 100 cx a R$ 50, todas vendidas. Setembro:
  // 100 cx a R$ 120. A média de TODAS as entradas dava (5.000 + 12.000) / 200 =
  // R$ 85: vender a R$ 110 aparecia como lucro de R$ 2.500 quando o real é
  // prejuízo de R$ 1.000.
  it("mercadoria que já saiu não pesa no custo da que chegou depois", async () => {
    await comprar(100, 50);
    await vender(100, 50);
    await comprar(100, 120);

    expect(Number(await custoAtual()).toFixed(2)).toBe("120.00");
    const p = await posicao();
    expect(p.avgCost.toFixed(2)).toBe("120.00");
    // O cartão fecha com a conta de cabeça: 100 × 120 (antes: custo 85 e valor 12.000).
    expect(p.value.toFixed(2)).toBe("12000.00");

    const venda = await vender(100, 110);
    expect(Number(venda.items[0]!.unitCostAtSale).toFixed(2)).toBe("120.00");
    const lucro = 100 * 110 - 100 * Number(venda.items[0]!.unitCostAtSale);
    expect(lucro).toBe(-1000);
  });

  it("saldo zero vale zero — no produto E no painel (sem valor fantasma)", async () => {
    await comprar(100, 50);
    await vender(100, 50);
    await comprar(100, 120);
    await vender(100, 110);

    const p = await posicao();
    expect(Number(p.quantity)).toBe(0);
    // Antes sobrava 17.000 − 5.000 − 8.500 = R$ 3.500 no livro-razão; a tela
    // escondia e o cartão "valor em estoque" do painel mostrava.
    expect(p.value.toFixed(2)).toBe("0.00");
    expect((await EstoqueService.getTotalValue(tenantId)).toFixed(2)).toBe("0.00");
    // Sem saldo, a referência é a última entrada (é o que um acerto para mais herda).
    expect(p.avgCost.toFixed(2)).toBe("120.00");
  });

  it("o saldo só-quantidade do PDV bate com a posição da tela de Estoque", async () => {
    await comprar(100, 50);
    await vender(30, 60);
    await comprar(12.5, 70);

    const saldos = await EstoqueService.getQuantidades(tenantId);
    const posicoes = await EstoqueService.getPositions(tenantId);
    for (const p of posicoes) {
      expect(saldos[p.productId] ?? 0).toBe(Number(p.quantity));
    }
    expect(saldos[productId]).toBe(82.5);
  });

  it("média MÓVEL: a saída não muda a média, a entrada pondera com o que sobrou", async () => {
    await comprar(100, 50);
    await vender(50, 60);
    await comprar(100, 120);
    // Sobram 50 a R$ 50 + chegam 100 a R$ 120 → (2.500 + 12.000) / 150 = 96,6667.
    // (A média do histórico dava 85.)
    expect(Number(await custoAtual()).toFixed(4)).toBe("96.6667");

    const venda = await vender(30, 130);
    expect(Number(venda.items[0]!.unitCostAtSale).toFixed(4)).toBe("96.6667");
    // A saída não muda a média: os 120 que sobram continuam a 96,6667.
    expect(Number(await custoAtual()).toFixed(4)).toBe("96.6667");
    const p = await posicao();
    expect(Number(p.quantity)).toBe(120);
    expect(p.value.toFixed(2)).toBe("11600.00"); // 120 × 96,6667 = 11.600,004
  });

  it("quebra e acerto para menos saem pela média e não a alteram", async () => {
    await comprar(10, 10);
    await comprar(10, 20);
    await EstoqueService.registrarAjuste({ productId, type: "QUEBRA", quantity: 5 }, ctx);
    await EstoqueService.registrarAjuste({ productId, type: "AJUSTE", quantity: -5 }, ctx);
    expect(Number(await custoAtual()).toFixed(2)).toBe("15.00");
    expect((await posicao()).value.toFixed(2)).toBe("150.00");
  });

  it("custo errado gravado numa saída antiga não contamina a média", async () => {
    // Histórico gravado com a fórmula velha: a saída levou um custo que não
    // era o do estoque. O repasse ignora o custo gravado na saída.
    await comprar(100, 50);
    await prisma.stockMovement.create({
      data: { tenantId, productId, type: "SAIDA", quantity: 50, unitCost: 85, sourceType: "SALE" },
    });
    await comprar(50, 60);
    // Sobram 50 a R$ 50 + 50 a R$ 60 → 55 (o livro-razão bruto daria
    // (5.000 − 4.250 + 3.000) / 100 = 37,50).
    expect(Number(await custoAtual()).toFixed(2)).toBe("55.00");
  });

  it("a ordem é a de GRAVAÇÃO: compra lançada depois da venda que zerou recomeça a média", async () => {
    // As compras têm `movedAt` = hoje à meia-noite, e a venda `movedAt` = agora.
    // Pela data do movimento, a segunda compra viria ANTES da venda que zerou
    // o produto, e a média misturaria os dois preços.
    await comprar(10, 50);
    await vender(10, 60);
    await comprar(100, 120);
    expect(Number(await custoAtual()).toFixed(2)).toBe("120.00");
  });

  it("devolução por cancelamento volta pelo custo com que saiu", async () => {
    await comprar(100, 50);
    const venda = await vender(40, 70);
    await comprar(40, 80);
    // 60 a 50 + 40 a 80 → 62
    expect(Number(await custoAtual()).toFixed(2)).toBe("62.00");
    await VendasService.cancelarVenda({ id: venda.id, motivo: "teste" }, ctx);
    // + 40 a 50 (custo da venda) → (60×50 + 40×80 + 40×50) / 140 = 58,5714
    expect(Number(await custoAtual()).toFixed(4)).toBe("58.5714");
  });
});

describe("o SQL do custo médio confere com o repasse linha a linha", () => {
  /** PRNG determinístico (mulberry32), para a falha ser reproduzível. */
  function aleatorio(semente: number) {
    let a = semente;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  type Mov = {
    type: "ENTRADA" | "SAIDA" | "QUEBRA" | "AJUSTE";
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal;
  };

  it.each([1, 7, 42, 2026])("sequência aleatória (semente %i), passando por zero", async (semente) => {
    const rnd = aleatorio(semente);
    const inicio = Date.now() - 10_000_000;
    const movs: Mov[] = [];
    let saldo = new Prisma.Decimal(0);
    for (let i = 0; i < 150; i++) {
      const r = rnd();
      if (saldo.isZero() || r < 0.3) {
        const q = new Prisma.Decimal(Math.floor(rnd() * 40_000) + 1).dividedBy(1000);
        const c = new Prisma.Decimal(Math.floor(rnd() * 1_500_000) + 100).dividedBy(10_000);
        movs.push({ type: rnd() < 0.85 ? "ENTRADA" : "AJUSTE", quantity: q, unitCost: c });
        saldo = saldo.plus(q);
      } else {
        // Às vezes zera o produto de propósito, para exercitar o recomeço.
        const q =
          r > 0.9
            ? saldo
            : Prisma.Decimal.min(
                saldo,
                new Prisma.Decimal(Math.floor(rnd() * 15_000) + 1).dividedBy(1000),
              );
        const tipo = r > 0.85 ? "QUEBRA" : r > 0.8 ? "AJUSTE" : "SAIDA";
        // Custo gravado na saída propositalmente sem sentido: o repasse o ignora.
        movs.push({
          type: tipo,
          quantity: tipo === "AJUSTE" ? q.negated() : q,
          unitCost: new Prisma.Decimal(Math.floor(rnd() * 999) + 1),
        });
        saldo = saldo.minus(q);
      }
    }
    await prisma.stockMovement.createMany({
      data: movs.map((m, i) => ({
        tenantId,
        productId,
        type: m.type,
        quantity: m.quantity,
        unitCost: m.unitCost,
        createdAt: new Date(inicio + i * 1000),
        // `movedAt` embaralhado: a ordem do repasse é a de gravação.
        movedAt: new Date(inicio - Math.floor(rnd() * 1e9)),
      })),
    });

    // O repasse de referência, em Decimal, linha a linha, na ordem de gravação.
    let q = new Prisma.Decimal(0);
    let media = new Prisma.Decimal(0);
    let ultimaEntrada = new Prisma.Decimal(0);
    for (const m of movs) {
      const comSinal =
        m.type === "ENTRADA" || m.type === "AJUSTE" ? m.quantity : m.quantity.negated();
      if (comSinal.greaterThan(0)) {
        const antes = Prisma.Decimal.max(q, 0);
        media = antes.times(media).plus(comSinal.times(m.unitCost)).dividedBy(antes.plus(comSinal));
        ultimaEntrada = m.unitCost;
      }
      q = q.plus(comSinal);
    }
    const esperado = (q.greaterThan(0) ? media : ultimaEntrada).toDecimalPlaces(4);

    const custo = (await custoAtual())!;
    expect(custo.toFixed(4)).toBe(esperado.toFixed(4));

    const p = await posicao();
    expect(p.quantity.toString()).toBe(q.toString());
    const valorEsperado = q.greaterThan(0)
      ? q.times(esperado).toDecimalPlaces(2)
      : new Prisma.Decimal(0);
    expect(p.value.toFixed(2)).toBe(valorEsperado.toFixed(2));
    expect((await EstoqueService.getTotalValue(tenantId)).toFixed(2)).toBe(
      valorEsperado.toFixed(2),
    );
  });
});

describe("frete de compra de valor zero entra no custo (regressão)", () => {
  // Consignação/bonificação: preço acertado depois, lançado a R$ 0. O rateio
  // pelo valor via total 0 e dava R$ 0 de frete a cada item — os R$ 200 do
  // caminhão sumiam do custo do estoque e do CMV.
  it("rateia pela quantidade e o valor em estoque é o frete", async () => {
    const outro = await getTenantPrisma(tenantId).product.create({
      data: { tenantId, name: "Chuchu", saleUnit: "CAIXA" },
    });
    const compra = await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: hoje,
        freight: 200,
        items: [
          { productId, quantity: 30, unitPrice: 0 },
          { productId: outro.id, quantity: 10, unitPrice: 0 },
        ],
      },
      ctx,
    );
    const porProduto = new Map(compra.items.map((it) => [it.productId, it]));
    expect(Number(porProduto.get(productId)!.freightShare)).toBe(150);
    expect(Number(porProduto.get(outro.id)!.freightShare)).toBe(50);
    expect(Number(porProduto.get(productId)!.unitCost)).toBe(5);
    expect(Number(porProduto.get(outro.id)!.unitCost)).toBe(5);
    expect(Number(compra.totalAmount)).toBe(200);
    expect(Number(await EstoqueService.getTotalValue(tenantId))).toBe(200);
  });

  it("as partes do frete somam exatamente o frete (resíduo do arredondamento)", async () => {
    const compra = await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: hoje,
        freight: 0.1,
        items: [
          { productId, quantity: 1, unitPrice: 10 },
          { productId, quantity: 1, unitPrice: 10 },
          { productId, quantity: 1, unitPrice: 10 },
        ],
      },
      ctx,
    );
    const soma = compra.items.reduce((s, it) => s.plus(it.freightShare), new Prisma.Decimal(0));
    expect(soma.toFixed(2)).toBe("0.10");
  });
});
