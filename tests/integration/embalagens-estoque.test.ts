import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Estoque de embalagens: saldo DERIVADO do livro-razão, igual ao de produtos.
 *
 * O ponto delicado é o controle começar desligado: quem já vendia embalagem
 * nunca registrou entrada, e ligar tudo de uma vez mostraria saldo negativo em
 * todo canto — falta de histórico, não falta de embalagem.
 */
const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
let tenantId = "";
let ctx: TenantCtx;

async function novoTipo(nome: string) {
  return prisma.packagingType.create({
    data: { tenantId, name: `${nome}-${uniq()}` },
  });
}

async function saldoDe(id: string) {
  return (await EmbalagensService.saldos(tenantId)).get(id);
}

beforeAll(async () => {
  tenantId = await createTestTenant("EMBALAGENS ESTOQUE");
  tenants.push(tenantId);
  ctx = makeCtx(tenantId);
});

afterAll(async () => {
  await prisma.packagingMovement.deleteMany({ where: { tenantId } });
  await prisma.packagingSale.deleteMany({ where: { tenantId } });
  await prisma.packagingType.deleteMany({ where: { tenantId } });
  await cleanupTenants(tenants);
});

describe("Tipo sem controle de estoque (comportamento anterior preservado)", () => {
  it("nasce com o controle desligado", async () => {
    const tipo = await novoTipo("Sacaria");
    expect(tipo.tracksStock).toBe(false);
  });

  it("vende à vontade e NÃO gera movimento — não inventa saldo negativo", async () => {
    const tipo = await novoTipo("Papelao");

    await EmbalagensService.createSale(
      {
        packagingTypeId: tipo.id,
        quantity: 500,
        unitPrice: 2,
        saleDate: new Date().toISOString(),
        customerName: "Cliente",
      },
      ctx,
    );

    expect(await saldoDe(tipo.id)).toBeUndefined();
    const movs = await prisma.packagingMovement.count({
      where: { packagingTypeId: tipo.id },
    });
    expect(movs).toBe(0);
  });
});

describe("Ligar o controle de estoque", () => {
  it("grava o que existe hoje como saldo inicial", async () => {
    const tipo = await novoTipo("Caixa");

    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 200 },
      ctx,
    );

    const depois = await prisma.packagingType.findUniqueOrThrow({ where: { id: tipo.id } });
    expect(depois.tracksStock).toBe(true);
    expect(await saldoDe(tipo.id)).toBe(200);
  });

  it("aceita começar do zero, sem criar movimento à toa", async () => {
    const tipo = await novoTipo("Zerado");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 0 },
      ctx,
    );
    const movs = await prisma.packagingMovement.count({ where: { packagingTypeId: tipo.id } });
    expect(movs).toBe(0);
    expect(await saldoDe(tipo.id)).toBeUndefined(); // sem movimento, sem linha
  });

  it("recusa ligar duas vezes — o segundo saldo inicial duplicaria o estoque", async () => {
    const tipo = await novoTipo("Duplo");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 50 },
      ctx,
    );
    await expect(
      EmbalagensService.ativarControleEstoque(
        { packagingTypeId: tipo.id, quantidadeAtual: 50 },
        ctx,
      ),
    ).rejects.toThrow(/já está ligado/i);
    expect(await saldoDe(tipo.id)).toBe(50);
  });
});

describe("Venda com controle ligado", () => {
  it("baixa o saldo na mesma transação", async () => {
    const tipo = await novoTipo("Saco");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 100 },
      ctx,
    );

    await EmbalagensService.createSale(
      {
        packagingTypeId: tipo.id,
        quantity: 30,
        unitPrice: 1.5,
        saleDate: new Date().toISOString(),
        customerName: "Maria",
      },
      ctx,
    );

    expect(await saldoDe(tipo.id)).toBe(70);
  });

  it("RECUSA vender mais do que tem, dizendo quanto tem", async () => {
    const tipo = await novoTipo("Pouco");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 8 },
      ctx,
    );

    await expect(
      EmbalagensService.createSale(
        {
          packagingTypeId: tipo.id,
          quantity: 200,
          unitPrice: 1,
          saleDate: new Date().toISOString(),
          customerName: "Cliente",
        },
        ctx,
      ),
    ).rejects.toThrow(/8/);

    // Nada pode ter sido gravado pela tentativa recusada.
    expect(await saldoDe(tipo.id)).toBe(8);
    const vendas = await prisma.packagingSale.count({ where: { packagingTypeId: tipo.id } });
    expect(vendas).toBe(0);
  });

  it("vender exatamente o saldo é permitido", async () => {
    const tipo = await novoTipo("Exato");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 10 },
      ctx,
    );
    await EmbalagensService.createSale(
      {
        packagingTypeId: tipo.id,
        quantity: 10,
        unitPrice: 1,
        saleDate: new Date().toISOString(),
        customerName: "Cliente",
      },
      ctx,
    );
    expect(await saldoDe(tipo.id)).toBe(0);
  });
});

describe("Entrada de embalagens", () => {
  it("soma ao saldo", async () => {
    const tipo = await novoTipo("Reposto");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 5 },
      ctx,
    );
    await EmbalagensService.registrarEntrada(
      { packagingTypeId: tipo.id, quantity: 95 },
      ctx,
    );
    expect(await saldoDe(tipo.id)).toBe(100);
  });

  it("recusa entrada em tipo sem controle ligado", async () => {
    const tipo = await novoTipo("SemControle");
    await expect(
      EmbalagensService.registrarEntrada({ packagingTypeId: tipo.id, quantity: 10 }, ctx),
    ).rejects.toThrow(/desligado/i);
  });
});

describe("Excluir venda devolve o saldo", () => {
  it("apaga a baixa em vez de compensar — sem entrada fantasma no histórico", async () => {
    const tipo = await novoTipo("Estorno");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 40 },
      ctx,
    );
    const venda = await EmbalagensService.createSale(
      {
        packagingTypeId: tipo.id,
        quantity: 15,
        unitPrice: 3,
        saleDate: new Date().toISOString(),
        customerName: "Cliente",
      },
      ctx,
    );
    expect(await saldoDe(tipo.id)).toBe(25);

    await EmbalagensService.removeSale(venda.id, ctx);

    expect(await saldoDe(tipo.id)).toBe(40);
    // Só o AJUSTE inicial sobrou: nem SAIDA, nem ENTRADA de estorno.
    const movs = await prisma.packagingMovement.findMany({
      where: { packagingTypeId: tipo.id },
    });
    expect(movs).toHaveLength(1);
    expect(movs[0].type).toBe("AJUSTE");
  });
});
