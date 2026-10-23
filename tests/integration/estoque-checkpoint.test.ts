import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import {
  EstoqueService,
  custoMedioPonderado,
  saldoECustoMedio,
} from "@/lib/services/estoque.service";
import { VendasService } from "@/lib/services/vendas.service";
import {
  ORIGEM_AJUSTE,
  ORIGEM_AJUSTE_DESFEITO,
  ORIGEM_COMPRA,
  ORIGEM_COMPRA_CANCELADA,
  ORIGEM_VENDA,
} from "@/lib/estoque/origens";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * O checkpoint do custo médio é um atalho: o repasse começa do estado gravado
 * em vez de reler a história do produto. Atalho que muda o número é defeito,
 * então aqui tudo é comparação — a mesma consulta com e sem checkpoint, em
 * todos os pontos de corte, tem de dar exatamente o mesmo saldo, custo, valor e
 * última movimentação.
 */

const tenants: string[] = [];
let tenantId = "";
let produtos: string[] = [];
const ctx = () => makeCtx(tenantId);

beforeAll(async () => {
  tenantId = await createTestTenant("CHECKPOINT");
  tenants.push(tenantId);
  const db = getTenantPrisma(tenantId);
  produtos = [];
  for (const name of ["Tomate", "Cebola", "Batata"]) {
    produtos.push((await db.product.create({ data: { tenantId, name, saleUnit: "CAIXA" } })).id);
  }
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

beforeEach(async () => {
  await prisma.stockCostCheckpoint.deleteMany({ where: { tenantId } });
  await prisma.saleItem.deleteMany({ where: { tenantId } });
  await prisma.salePayment.deleteMany({ where: { tenantId } });
  await prisma.sale.deleteMany({ where: { tenantId } });
  await prisma.stockMovement.deleteMany({ where: { tenantId } });
});

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

const dec = (n: number, casas: number) => new Prisma.Decimal(n).toDecimalPlaces(casas);

/** Tudo o que sai do repasse, pelas três portas que o usam. */
async function retrato() {
  const posicoes = (await EstoqueService.getPositions(tenantId)).map((p) => ({
    id: p.productId,
    quantidade: p.quantity.toString(),
    custo: p.avgCost!.toString(),
    valor: p.value.toString(),
    ultimo: p.lastMovementAt?.toISOString() ?? null,
  }));
  const custos = Object.fromEntries(
    [...(await custoMedioPonderado(prisma, tenantId, produtos))].map(([k, v]) => [k, v.toString()]),
  );
  const { saldo, custo } = await saldoECustoMedio(prisma, tenantId, produtos);
  return {
    posicoes,
    custos,
    saldo: Object.fromEntries([...saldo].map(([k, v]) => [k, v.toString()])),
    custoVenda: Object.fromEntries([...custo].map(([k, v]) => [k, v.toString()])),
    total: (await EstoqueService.getTotalValue(tenantId)).toString(),
  };
}

/**
 * Livro-razão aleatório de três produtos, com tudo o que o repasse trata de
 * forma especial: saldo que zera e fica negativo, AJUSTE para os dois lados,
 * compra cancelada e ajuste desfeito (os pares que saem juntos), saídas com
 * custo gravado sem sentido.
 */
async function livroRazao(semente: number, linhas: number, inicio: number) {
  const rnd = aleatorio(semente);
  const saldos = new Map(produtos.map((p) => [p, 0]));
  const data: Prisma.StockMovementCreateManyInput[] = [];
  let t = inicio;
  const mov = (m: Omit<Prisma.StockMovementCreateManyInput, "tenantId" | "createdAt" | "movedAt">) => {
    t += 1000;
    data.push({
      ...m,
      tenantId,
      createdAt: new Date(t),
      // Embaralhado: a ordem do repasse é a de gravação.
      movedAt: new Date(inicio - Math.floor(rnd() * 1e9)),
    });
  };
  for (let i = 0; i < linhas; i++) {
    const productId = produtos[Math.floor(rnd() * produtos.length)]!;
    const saldo = saldos.get(productId)!;
    const r = rnd();
    if (saldo <= 0 || r < 0.3) {
      const q = Math.floor(rnd() * 40_000 + 1) / 1000;
      const c = Math.floor(rnd() * 1_500_000 + 100) / 10_000;
      const sourceId = `c-${semente}-${i}`;
      mov({ productId, type: "ENTRADA", quantity: dec(q, 3), unitCost: dec(c, 4), sourceType: ORIGEM_COMPRA, sourceId });
      saldos.set(productId, saldo + q);
      if (rnd() < 0.15) {
        // Compra cancelada: o estorno, às vezes bem depois (atravessa o corte).
        if (rnd() < 0.5) t += 50_000;
        mov({
          productId,
          type: "SAIDA",
          quantity: dec(q, 3),
          unitCost: dec(c, 4),
          sourceType: ORIGEM_COMPRA_CANCELADA,
          sourceId,
        });
        saldos.set(productId, saldo);
      }
    } else if (r < 0.4) {
      // Ajuste manual, às vezes desfeito.
      const q = Math.floor(rnd() * 5_000 + 1) / 1000;
      const id = `a-${semente}-${i}`;
      const positivo = rnd() < 0.5;
      data.push({
        id,
        tenantId,
        productId,
        type: "AJUSTE",
        quantity: dec(positivo ? q : -q, 3),
        unitCost: dec(Math.floor(rnd() * 900_000 + 100) / 10_000, 4),
        sourceType: ORIGEM_AJUSTE,
        createdAt: new Date((t += 1000)),
        movedAt: new Date(t),
      });
      saldos.set(productId, saldo + (positivo ? q : -q));
      if (rnd() < 0.3) {
        mov({
          productId,
          type: "AJUSTE",
          quantity: dec(positivo ? -q : q, 3),
          sourceType: ORIGEM_AJUSTE_DESFEITO,
          sourceId: id,
        });
        saldos.set(productId, saldo);
      }
    } else {
      // Saída; às vezes zera ou passa do saldo (dado antigo existe assim).
      const q = r > 0.95 ? saldo + 1 : r > 0.88 ? saldo : Math.min(saldo, Math.floor(rnd() * 15_000 + 1) / 1000);
      const tipo = r > 0.85 ? "QUEBRA" : r > 0.82 ? "DOACAO" : "SAIDA";
      mov({
        productId,
        type: tipo,
        quantity: dec(q, 3),
        unitCost: dec(Math.floor(rnd() * 999) + 1, 4),
        sourceType: tipo === "SAIDA" ? ORIGEM_VENDA : ORIGEM_AJUSTE,
      });
      saldos.set(productId, saldo - q);
    }
  }
  await prisma.stockMovement.createMany({ data });
  return data.map((d) => d.createdAt as Date);
}

describe("checkpoint do custo médio dá o MESMO resultado que o repasse inteiro", () => {
  it.each([3, 11, 99, 2026])("livro-razão aleatório (semente %i), cortes em vários pontos", async (semente) => {
    const inicio = Date.now() - 30 * 24 * 3600 * 1000;
    const datas = await livroRazao(semente, 240, inicio);
    const semCheckpoint = await retrato();

    // Cortes no começo, no meio (inclusive entre um par cancelado) e no fim,
    // AVANÇANDO como o cron faz — cada um parte do anterior.
    for (const fracao of [0.1, 0.33, 0.5, 0.77, 1]) {
      const ate = datas[Math.min(datas.length - 1, Math.floor(datas.length * fracao))]!;
      await EstoqueService.atualizarCheckpoints(tenantId, ate);
      expect(await retrato(), `corte em ${fracao}`).toEqual(semCheckpoint);
    }
    expect(await prisma.stockCostCheckpoint.count({ where: { tenantId } })).toBeGreaterThan(0);
  });

  it("corte direto num ponto avançado, sem passar pelos anteriores", async () => {
    const inicio = Date.now() - 30 * 24 * 3600 * 1000;
    const datas = await livroRazao(7, 200, inicio);
    const semCheckpoint = await retrato();
    await EstoqueService.atualizarCheckpoints(tenantId, datas[150]!);
    expect(await retrato()).toEqual(semCheckpoint);
  });

  it("checkpoint com saldo zero e com saldo negativo", async () => {
    const [tomate] = produtos;
    const inicio = Date.now() - 20 * 24 * 3600 * 1000;
    const em = (s: number) => new Date(inicio + s * 1000);
    await prisma.stockMovement.createMany({
      data: [
        { tenantId, productId: tomate!, type: "ENTRADA", quantity: 10, unitCost: 5, createdAt: em(1) },
        { tenantId, productId: tomate!, type: "SAIDA", quantity: 10, createdAt: em(2) },
        { tenantId, productId: produtos[1]!, type: "ENTRADA", quantity: 4, unitCost: 7, createdAt: em(3) },
        { tenantId, productId: produtos[1]!, type: "SAIDA", quantity: 6, createdAt: em(4) },
      ],
    });
    await EstoqueService.atualizarCheckpoints(tenantId, em(5));
    const ck = await prisma.stockCostCheckpoint.findMany({ where: { tenantId }, orderBy: { saldo: "asc" } });
    expect(ck.map((c) => Number(c.saldo))).toEqual([-2, 0]);
    // Sem saldo não há média; a referência é a última entrada.
    expect(ck.every((c) => c.custo === null)).toBe(true);

    // Movimento novo depois do checkpoint: a média recomeça na entrada nova.
    await prisma.stockMovement.createMany({
      data: [
        { tenantId, productId: tomate!, type: "ENTRADA", quantity: 3, unitCost: 9, createdAt: em(6) },
        { tenantId, productId: produtos[1]!, type: "ENTRADA", quantity: 5, unitCost: 11, createdAt: em(7) },
      ],
    });
    const comCheckpoint = await retrato();
    await prisma.stockCostCheckpoint.deleteMany({ where: { tenantId } });
    expect(comCheckpoint).toEqual(await retrato());
    expect(comCheckpoint.custos[tomate!]).toBe("9");
  });

  it("checkpoint POSITIVO dentro de um ciclo que recomeçou num saldo negativo", async () => {
    // Entrada 10 a R$ 5, saída 11 (saldo -1: o ciclo recomeça ali), entrada 4 a
    // R$ 7 — CHECKPOINT (saldo 3, mas o ciclo acumulou 4) — saída 2, entrada 10
    // a R$ 9. Sobram 1 a R$ 7 e 10 a R$ 9: R$ 97 / 11 = R$ 8,8182, com e sem
    // checkpoint (a conta que contava o ciclo a partir do zero dava R$ 8,6667).
    const [tomate] = produtos;
    const inicio = Date.now() - 20 * 24 * 3600 * 1000;
    const em = (s: number) => new Date(inicio + s * 1000);
    await prisma.stockMovement.createMany({
      data: [
        { tenantId, productId: tomate!, type: "ENTRADA", quantity: 10, unitCost: 5, createdAt: em(1) },
        { tenantId, productId: tomate!, type: "SAIDA", quantity: 11, createdAt: em(2) },
        { tenantId, productId: tomate!, type: "ENTRADA", quantity: 4, unitCost: 7, createdAt: em(3) },
      ],
    });
    await EstoqueService.atualizarCheckpoints(tenantId, em(4));
    const ck = await prisma.stockCostCheckpoint.findFirstOrThrow({ where: { tenantId, productId: tomate! } });
    expect(Number(ck.saldo)).toBe(3);
    expect(Number(ck.deslocamento)).toBe(-1);

    await prisma.stockMovement.createMany({
      data: [
        { tenantId, productId: tomate!, type: "SAIDA", quantity: 2, createdAt: em(5) },
        { tenantId, productId: tomate!, type: "ENTRADA", quantity: 10, unitCost: 9, createdAt: em(6) },
      ],
    });
    const comCheckpoint = await retrato();
    await prisma.stockCostCheckpoint.deleteMany({ where: { tenantId } });
    expect(comCheckpoint).toEqual(await retrato());
    expect(comCheckpoint.custos[tomate!]).toBe("8.8182");
  });

  it("sem movimento depois do checkpoint, a última entrada e a última data vêm dele", async () => {
    const inicio = Date.now() - 20 * 24 * 3600 * 1000;
    const em = (s: number) => new Date(inicio + s * 1000);
    await prisma.stockMovement.createMany({
      data: [
        { tenantId, productId: produtos[0]!, type: "ENTRADA", quantity: 10, unitCost: 5, createdAt: em(1), movedAt: em(1) },
        { tenantId, productId: produtos[0]!, type: "ENTRADA", quantity: 10, unitCost: 8, createdAt: em(2), movedAt: em(2) },
        { tenantId, productId: produtos[0]!, type: "SAIDA", quantity: 20, createdAt: em(3), movedAt: em(3) },
      ],
    });
    const semCheckpoint = await retrato();
    await EstoqueService.atualizarCheckpoints(tenantId, em(10));
    expect(await retrato()).toEqual(semCheckpoint);
    expect(semCheckpoint.custos[produtos[0]!]).toBe("8");
  });

  it("a venda grava o mesmo custo com e sem checkpoint", async () => {
    const inicio = Date.now() - 30 * 24 * 3600 * 1000;
    await livroRazao(42, 150, inicio);
    // Garante saldo para vender.
    await prisma.stockMovement.create({
      data: { tenantId, productId: produtos[2]!, type: "ENTRADA", quantity: 50, unitCost: 3.3333, createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) },
    });
    const esperado = (await custoMedioPonderado(prisma, tenantId, [produtos[2]!])).get(produtos[2]!)!;

    await EstoqueService.atualizarCheckpoints(tenantId);
    expect(await prisma.stockCostCheckpoint.count({ where: { tenantId } })).toBe(produtos.length);

    const venda = await VendasService.registrarVenda(
      { paymentMethod: "DINHEIRO", items: [{ productId: produtos[2]!, quantity: 1, unitPrice: 10 }] },
      ctx(),
    );
    expect(venda.items[0]!.unitCostAtSale!.toString()).toBe(esperado.toString());

    // E o estado depois da venda também bate com o repasse inteiro.
    const comCheckpoint = await retrato();
    await prisma.stockCostCheckpoint.deleteMany({ where: { tenantId } });
    expect(comCheckpoint).toEqual(await retrato());
  });
});

describe("atualização dos checkpoints", () => {
  it("o padrão é 7 dias atrás: movimento recente nunca entra no checkpoint", async () => {
    const velho = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await prisma.stockMovement.createMany({
      data: [
        { tenantId, productId: produtos[0]!, type: "ENTRADA", quantity: 10, unitCost: 5, createdAt: velho },
        { tenantId, productId: produtos[0]!, type: "ENTRADA", quantity: 10, unitCost: 9 },
      ],
    });
    await EstoqueService.atualizarCheckpoints(tenantId);
    const ck = await prisma.stockCostCheckpoint.findFirstOrThrow({ where: { tenantId } });
    expect(Number(ck.saldo)).toBe(10);
    expect(ck.ateCreatedAt.getTime()).toBeLessThan(Date.now() - 6 * 24 * 3600 * 1000);
  });

  it("corte mais antigo que o checkpoint gravado não o rebaixa", async () => {
    const inicio = Date.now() - 20 * 24 * 3600 * 1000;
    const em = (s: number) => new Date(inicio + s * 1000);
    await prisma.stockMovement.createMany({
      data: [
        { tenantId, productId: produtos[0]!, type: "ENTRADA", quantity: 10, unitCost: 5, createdAt: em(1) },
        { tenantId, productId: produtos[0]!, type: "ENTRADA", quantity: 10, unitCost: 9, createdAt: em(5) },
      ],
    });
    await EstoqueService.atualizarCheckpoints(tenantId, em(10));
    const semCheckpoint = await retrato();
    await EstoqueService.atualizarCheckpoints(tenantId, em(2));
    const ck = await prisma.stockCostCheckpoint.findFirstOrThrow({ where: { tenantId } });
    expect(ck.ateCreatedAt.getTime()).toBe(em(10).getTime());
    expect(await retrato()).toEqual(semCheckpoint);
  });

  it("o lote do cron processa a empresa e respeita o prazo", async () => {
    await prisma.stockMovement.create({
      data: {
        tenantId,
        productId: produtos[0]!,
        type: "ENTRADA",
        quantity: 1,
        unitCost: 1,
        createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      },
    });
    // Prazo já vencido: nada roda.
    const somente = [tenantId];
    expect(await EstoqueService.atualizarCheckpointsDeTodos({ prazo: Date.now() - 1, somente })).toEqual({
      empresas: 0,
      falhas: 0,
    });
    expect(await prisma.stockCostCheckpoint.count({ where: { tenantId } })).toBe(0);

    expect(
      await EstoqueService.atualizarCheckpointsDeTodos({ prazo: Date.now() + 60_000, somente }),
    ).toEqual({ empresas: 1, falhas: 0 });
    expect(await prisma.stockCostCheckpoint.count({ where: { tenantId } })).toBe(1);

    // Já atualizada hoje: o lote seguinte não a refaz.
    expect(
      await EstoqueService.atualizarCheckpointsDeTodos({ prazo: Date.now() + 60_000, somente }),
    ).toEqual({ empresas: 0, falhas: 0 });
  });

  it("o checkpoint é isolado por empresa", async () => {
    const outra = await createTestTenant("CHECKPOINT-OUTRA");
    tenants.push(outra);
    const p = await getTenantPrisma(outra).product.create({
      data: { tenantId: outra, name: "Alface", saleUnit: "CAIXA" },
    });
    const velho = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await prisma.stockMovement.create({
      data: { tenantId: outra, productId: p.id, type: "ENTRADA", quantity: 5, unitCost: 2, createdAt: velho },
    });
    await prisma.stockMovement.create({
      data: { tenantId, productId: produtos[0]!, type: "ENTRADA", quantity: 7, unitCost: 3, createdAt: velho },
    });
    await EstoqueService.atualizarCheckpoints(outra);
    expect(await prisma.stockCostCheckpoint.count({ where: { tenantId } })).toBe(0);
    expect(await getTenantPrisma(tenantId).stockCostCheckpoint.count()).toBe(0);
    expect(await getTenantPrisma(outra).stockCostCheckpoint.count()).toBe(1);
  });
});
