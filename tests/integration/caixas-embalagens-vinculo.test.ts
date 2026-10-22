import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CaixasService } from "@/lib/services/caixas.service";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { VendasService } from "@/lib/services/vendas.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";
import { isoDateTz } from "@/lib/tz";

/**
 * Caixa plástica: um estoque só para as abas Caixas e Embalagens.
 *
 * Antes eram dois estoques que não se falavam: vender "Caixa plástica" na aba
 * Embalagens não tirava nada das caixas, e comprar caixas não aparecia em
 * Embalagens. Agora o tipo vinculado (`caixaPlastica`) lê as caixas LIMPAS e
 * grava a venda e a entrada no livro-razão de caixas.
 */
const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];

afterAll(async () => {
  await cleanupTenants(tenants);
});

/** Empresa nova, com o tipo "Caixa plástica" vinculado e um tipo comum. */
async function novaEmpresa() {
  const tenantId = await createTestTenant(`VINCULO CAIXAS ${uniq()}`);
  tenants.push(tenantId);
  const ctx = makeCtx(tenantId);
  const caixa = await prisma.packagingType.create({
    data: { tenantId, name: "Caixa plástica", caixaPlastica: true },
  });
  return { tenantId, ctx, caixa };
}

async function entrada(ctx: TenantCtx, quantity: number, unitCost: number, dirty = false) {
  return CaixasService.registrar(
    { type: "ENTRADA", quantity, unitCost, dirty, movementDate: isoDateTz() },
    ctx,
  );
}

async function vender(ctx: TenantCtx, packagingTypeId: string, quantity: number) {
  return EmbalagensService.createSale(
    {
      packagingTypeId,
      quantity,
      unitPrice: 15,
      saleDate: isoDateTz(),
      customerName: "Freguês",
    },
    ctx,
  );
}

const disponivelEmEmbalagens = async (tenantId: string, tipoId: string) =>
  (await EmbalagensService.saldos(tenantId)).get(tipoId);

describe("o tipo vinculado mostra as caixas limpas", () => {
  it("entrada pela aba Caixas aparece em Embalagens; as sujas não contam", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();
    await entrada(ctx, 10, 5);
    await entrada(ctx, 4, 5, true);

    expect(await disponivelEmEmbalagens(tenantId, caixa.id)).toBe(10);
    expect((await CaixasService.getSaldo(tenantId)).limpas).toBe(10);
  });

  it("a saída emprestada no PDV também reduz o disponível em Embalagens", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();
    await entrada(ctx, 10, 5);
    const produto = await prisma.product.create({
      data: { tenantId, name: `Tomate ${uniq()}`, saleUnit: "CAIXA", active: true },
    });
    await prisma.stockMovement.create({
      data: { tenantId, productId: produto.id, type: "ENTRADA", quantity: 50, unitCost: 1 },
    });
    await VendasService.registrarVenda(
      {
        customerName: "Zé",
        paymentMethod: "DINHEIRO",
        saleDate: new Date().toISOString(),
        plasticCrateQty: 4,
        items: [{ productId: produto.id, quantity: 4, unitPrice: 10 }],
      },
      ctx,
    );

    expect(await disponivelEmEmbalagens(tenantId, caixa.id)).toBe(6);
  });
});

describe("venda de caixa plástica pela aba Embalagens", () => {
  it("tira das limpas, grava o custo médio e não fica com o cliente", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();
    await entrada(ctx, 10, 5);

    const venda = await vender(ctx, caixa.id, 3);

    expect(venda.unitCostAtSale?.toString()).toBe("5");
    const saldo = await CaixasService.getSaldo(tenantId);
    expect(saldo.limpas).toBe(7);
    expect(saldo.comClientes).toBe(0);
    expect(saldo.perdidas).toBe(0);
    expect(await disponivelEmEmbalagens(tenantId, caixa.id)).toBe(7);
    // Estoque próprio do tipo não é usado.
    expect(await prisma.packagingMovement.count({ where: { packagingTypeId: caixa.id } })).toBe(0);
  });

  it("recusa vender mais do que as limpas, mesmo com sujas no box", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();
    await entrada(ctx, 2, 5);
    await entrada(ctx, 8, 5, true);

    await expect(vender(ctx, caixa.id, 3)).rejects.toThrow(/2 caixa\(s\) plástica\(s\) limpa/);
    // A venda recusada não fica gravada.
    expect(await prisma.packagingSale.count({ where: { tenantId } })).toBe(0);
  });

  it("custo médio de duas entradas com custos diferentes", async () => {
    const { ctx, caixa } = await novaEmpresa();
    await entrada(ctx, 10, 4);
    await entrada(ctx, 10, 6);

    const venda = await vender(ctx, caixa.id, 5);
    expect(venda.unitCostAtSale?.toString()).toBe("5");
  });

  it("cancelar a venda devolve às limpas e o par sai do custo médio", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();
    await entrada(ctx, 10, 4);
    const venda = await vender(ctx, caixa.id, 10);
    expect((await CaixasService.getSaldo(tenantId)).limpas).toBe(0);

    await EmbalagensService.cancelarVenda({ id: venda.id }, ctx);

    expect((await CaixasService.getSaldo(tenantId)).limpas).toBe(10);
    // Sem o par fora do repasse, a saída de 10 zeraria a média e a entrada
    // seguinte formaria a média sozinha (8, e não 6).
    await entrada(ctx, 10, 8);
    expect((await vender(ctx, caixa.id, 1)).unitCostAtSale?.toString()).toBe("6");
  });

  it("duas vendas simultâneas das últimas caixas: uma passa, o saldo não fica negativo", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();
    await entrada(ctx, 5, 5);

    const resultados = await Promise.allSettled([
      vender(ctx, caixa.id, 5),
      vender(ctx, caixa.id, 5),
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await CaixasService.getSaldo(tenantId)).limpas).toBe(0);
  });
});

describe("entrada de caixas com custo", () => {
  it("entrada pela aba Embalagens vai para as caixas, com a conta paga da compra", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();

    const mov = await EmbalagensService.registrarEntrada(
      { packagingTypeId: caixa.id, quantity: 20, unitCost: 3 },
      ctx,
    );

    expect((await CaixasService.getSaldo(tenantId)).limpas).toBe(20);
    const conta = await prisma.expense.findFirstOrThrow({
      where: { tenantId, plasticCrateMovementId: mov.id },
    });
    expect(conta.origem).toBe("COMPRA_EMBALAGEM");
    expect(conta.status).toBe("PAGO");
    expect(conta.amount.toString()).toBe("60");
  });

  it("desfazer a entrada tira as caixas e cancela a conta", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();
    const mov = await entrada(ctx, 10, 5);

    // Pelo caminho da aba Embalagens, que cai no estoque de caixas.
    await EmbalagensService.desfazerEntrada({ id: mov.id }, ctx);

    expect((await CaixasService.getSaldo(tenantId)).limpas).toBe(0);
    expect(await disponivelEmEmbalagens(tenantId, caixa.id)).toBe(0);
    const conta = await prisma.expense.findFirstOrThrow({
      where: { plasticCrateMovementId: mov.id },
    });
    expect(conta.deletedAt).not.toBeNull();
    await expect(CaixasService.desfazerEntrada({ id: mov.id }, ctx)).rejects.toThrow(/já foi desfeita/);
  });

  it("não desfaz a entrada depois de uma venda que usou o custo dela", async () => {
    const { ctx, caixa } = await novaEmpresa();
    const mov = await entrada(ctx, 10, 5);
    await vender(ctx, caixa.id, 1);

    await expect(CaixasService.desfazerEntrada({ id: mov.id }, ctx)).rejects.toThrow(
      /venda ou perda/,
    );
  });

  it("o tipo vinculado não liga controle próprio nem aceita baixa", async () => {
    const { ctx, caixa } = await novaEmpresa();
    await expect(
      EmbalagensService.ativarControleEstoque({ packagingTypeId: caixa.id, quantidadeAtual: 0 }, ctx),
    ).rejects.toThrow(/estoque das caixas/);
    await expect(
      EmbalagensService.registrarBaixa(
        { packagingTypeId: caixa.id, quantity: 1, motivo: "quebrou" },
        ctx,
      ),
    ).rejects.toThrow(/Registrar perda/);
  });
});

describe("saldo antigo do tipo passa para as caixas", () => {
  it("transfere uma vez, pelo custo médio do tipo, sem conta nova", async () => {
    const { tenantId, ctx, caixa } = await novaEmpresa();
    // Estoque próprio de antes do vínculo: 12 caixas a R$ 9.
    await prisma.packagingMovement.create({
      data: { tenantId, packagingTypeId: caixa.id, type: "AJUSTE", quantity: 12, unitCost: 9 },
    });

    expect(await EmbalagensService.transferirSaldoParaCaixas(tenantId)).toBe(12);
    expect(await EmbalagensService.transferirSaldoParaCaixas(tenantId)).toBe(0);

    expect((await CaixasService.getSaldo(tenantId)).limpas).toBe(12);
    expect((await vender(ctx, caixa.id, 1)).unitCostAtSale?.toString()).toBe("9");
    expect(await prisma.expense.count({ where: { tenantId } })).toBe(0);
    // A entrada transferida não se desfaz como entrada manual.
    const transferida = await prisma.plasticCrateMovement.findFirstOrThrow({
      where: { tenantId, type: "ENTRADA" },
    });
    await expect(
      CaixasService.desfazerEntrada({ id: transferida.id }, ctx),
    ).rejects.toThrow(/não encontrada/);
  });
});

describe("tipo comum continua com estoque próprio", () => {
  it("papelão com controle não mexe nas caixas", async () => {
    const { tenantId, ctx } = await novaEmpresa();
    await entrada(ctx, 5, 5);
    const papelao = await prisma.packagingType.create({
      data: { tenantId, name: `Papelão ${uniq()}` },
    });
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: papelao.id, quantidadeAtual: 30, custoUnitario: 1 },
      ctx,
    );

    await vender(ctx, papelao.id, 10);

    expect((await EmbalagensService.saldos(tenantId)).get(papelao.id)).toBe(20);
    expect((await CaixasService.getSaldo(tenantId)).limpas).toBe(5);
  });
});
