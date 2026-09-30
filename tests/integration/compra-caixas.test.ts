import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ComprasService } from "@/lib/services/compras.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Entrada de caixas plásticas junto com a compra.
 *
 * Antes eram dois lançamentos em telas diferentes para um fato só, e a segunda
 * metade era esquecida — o saldo de caixas divergia do que existe no box. Agora
 * a mesma transação grava a compra, a entrada de estoque e a entrada de caixas.
 */
const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
let tenantId = "";
let ctx: TenantCtx;
let produtoId = "";

async function comprar(opts: {
  caixasRecebidas?: number;
  caixasQuebradas?: number;
  caixasSujas?: boolean;
}) {
  return ComprasService.registrarCompra(
    {
      supplierId: null,
      purchaseDate: new Date().toISOString(),
      freight: 0,
      items: [{ productId: produtoId, quantity: 10, unitPrice: 5 }],
      ...opts,
    },
    ctx,
  );
}

beforeAll(async () => {
  tenantId = await createTestTenant("COMPRA CAIXAS");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
  const p = await prisma.product.create({
    data: { tenantId, name: `Tomate ${uniq()}`, saleUnit: "CAIXA", active: true },
  });
  produtoId = p.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
});

describe("Compra sem caixas plásticas", () => {
  it("não cria movimento de caixa — comportamento anterior preservado", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    await comprar({});
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.limpas).toBe(antes.limpas);
    expect(depois.vazias).toBe(antes.vazias);
  });
});

describe("Compra com caixas plásticas", () => {
  it("entra no livro-razão como LIMPAS, prontas para vender", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    await comprar({ caixasRecebidas: 40 });
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.limpas).toBe(antes.limpas + 40);
    expect(depois.sujas).toBe(antes.sujas);
  });

  it("caixa suja vai para a fila de higienização, não para as limpas", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    await comprar({ caixasRecebidas: 25, caixasSujas: true });
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.sujas).toBe(antes.sujas + 25);
    expect(depois.limpas).toBe(antes.limpas);
  });

  it("quebradas na chegada contam como perda, não como estoque", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    await comprar({ caixasRecebidas: 30, caixasQuebradas: 4 });
    const depois = await CaixasService.getSaldo(tenantId);
    // "Quantas caixas" é o TOTAL que chegou (a compra recusa quebradas acima
    // dele). Esta asserção dizia +30 e cristalizava o defeito: as 4 quebradas
    // contavam como limpas E como perdidas — 34 caixas de 30 —, e o sistema
    // aceitava SAIDA de 30 com só 26 boas no box.
    expect(depois.limpas).toBe(antes.limpas + 26);
    expect(depois.perdidas).toBe(antes.perdidas + 4);
  });

  it("quebradas de uma entrada SUJA saem das sujas, não das limpas", async () => {
    const antes = await CaixasService.getSaldo(tenantId);
    await comprar({ caixasRecebidas: 20, caixasQuebradas: 3, caixasSujas: true });
    const depois = await CaixasService.getSaldo(tenantId);
    expect(depois.sujas).toBe(antes.sujas + 17);
    expect(depois.limpas).toBe(antes.limpas);
    expect(depois.perdidas).toBe(antes.perdidas + 3);
  });

  it("SAIDA acima das boas é recusada: as quebradas não se vendem", async () => {
    const t = await createTestTenant("COMPRA CAIXAS SAIDA");
    tenants.push(t);
    const c = makeCtx(t);
    const p = await prisma.product.create({
      data: { tenantId: t, name: `Tomate ${uniq()}`, saleUnit: "CAIXA", active: true },
    });
    await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: new Date().toISOString(),
        freight: 0,
        caixasRecebidas: 30,
        caixasQuebradas: 4,
        items: [{ productId: p.id, quantity: 10, unitPrice: 5 }],
      },
      c,
    );
    await expect(
      CaixasService.registrar(
        {
          type: "SAIDA",
          quantity: 30,
          customerName: "Mercadinho",
          movementDate: new Date().toISOString(),
        },
        c,
      ),
    ).rejects.toThrow(/26 caixa\(s\) limpa/);
  });

  it("vincula o movimento à compra e registra a origem", async () => {
    const compra = await comprar({ caixasRecebidas: 12 });
    const mov = await prisma.plasticCrateMovement.findFirst({
      where: { tenantId, type: "ENTRADA", quantity: 12 },
      orderBy: { createdAt: "desc" },
    });
    expect(mov).toBeTruthy();
    expect(mov!.notes).toMatch(/compra/i);
    expect(compra.id).toBeTruthy();
  });

  it("RECUSA quebradas maior que o total recebido", async () => {
    await expect(comprar({ caixasRecebidas: 5, caixasQuebradas: 9 })).rejects.toThrow(
      /quebradas/i,
    );
  });

  it("a compra e a entrada de caixas são atômicas", async () => {
    const comprasAntes = await prisma.purchase.count({ where: { tenantId } });
    // Produto inexistente derruba a transação inteira: nem compra, nem caixas.
    await expect(
      ComprasService.registrarCompra(
        {
          supplierId: null,
          purchaseDate: new Date().toISOString(),
          freight: 0,
          caixasRecebidas: 99,
          items: [{ productId: "nao-existe", quantity: 1, unitPrice: 1 }],
        },
        ctx,
      ),
    ).rejects.toThrow();

    expect(await prisma.purchase.count({ where: { tenantId } })).toBe(comprasAntes);
    const orfao = await prisma.plasticCrateMovement.count({
      where: { tenantId, quantity: 99 },
    });
    expect(orfao).toBe(0);
  });
});

/**
 * Sem o módulo `caixas`, a compra não mexe no livro-razão de caixas.
 *
 * O gate existia na venda (`registrarVenda` zera as caixas) e faltava na
 * compra: um POST com `caixasRecebidas` gravava ENTRADA para uma empresa que
 * não tem o controle — e a tela nem oferecia o campo.
 */
describe("Compra sem o módulo de caixas (regressão)", () => {
  it("grava a compra e o estoque, mas nenhum movimento de caixa", async () => {
    const semCaixas: TenantCtx = {
      ...ctx,
      session: { ...ctx.session, modules: (ctx.session.modules ?? []).filter((m) => m !== "caixas") },
    };
    const antes = await prisma.plasticCrateMovement.count({ where: { tenantId } });

    const compra = await ComprasService.registrarCompra(
      {
        supplierId: null,
        purchaseDate: new Date().toISOString(),
        freight: 0,
        caixasRecebidas: 15,
        caixasQuebradas: 2,
        items: [{ productId: produtoId, quantity: 10, unitPrice: 5 }],
      },
      semCaixas,
    );

    expect(compra.id).toBeTruthy();
    expect(
      await prisma.stockMovement.count({ where: { sourceType: "PURCHASE", sourceId: compra.id } }),
    ).toBe(1);
    expect(await prisma.plasticCrateMovement.count({ where: { tenantId } })).toBe(antes);
  });
});
