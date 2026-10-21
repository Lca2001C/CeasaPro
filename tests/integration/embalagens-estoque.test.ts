import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";
import { isoDateTz } from "@/lib/tz";

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
      { packagingTypeId: tipo.id, quantity: 95, unitCost: 2 },
      ctx,
    );
    expect(await saldoDe(tipo.id)).toBe(100);
  });

  it("recusa entrada em tipo sem controle ligado", async () => {
    const tipo = await novoTipo("SemControle");
    await expect(
      EmbalagensService.registrarEntrada(
        { packagingTypeId: tipo.id, quantity: 10, unitCost: 2 },
        ctx,
      ),
    ).rejects.toThrow(/desligado/i);
  });
});

describe("Custo da embalagem vendida", () => {
  const hoje = isoDateTz(new Date());

  it("a venda grava o custo médio móvel de antes dela", async () => {
    const tipo = await novoTipo("Custo");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 10, custoUnitario: 2 },
      ctx,
    );
    await EmbalagensService.registrarEntrada(
      { packagingTypeId: tipo.id, quantity: 10, unitCost: 4 },
      ctx,
    );
    // 10 a R$ 2 + 10 a R$ 4 = média R$ 3.
    const v1 = await EmbalagensService.createSale(
      { packagingTypeId: tipo.id, saleDate: hoje, quantity: 5, unitPrice: 6 },
      ctx,
    );
    expect(Number(v1.unitCostAtSale)).toBe(3);

    // Sobram 15 a R$ 3; entram 10 a R$ 6 → (45 + 60) / 25 = R$ 4,20.
    await EmbalagensService.registrarEntrada(
      { packagingTypeId: tipo.id, quantity: 10, unitCost: 6 },
      ctx,
    );
    const v2 = await EmbalagensService.createSale(
      { packagingTypeId: tipo.id, saleDate: hoje, quantity: 1, unitPrice: 6 },
      ctx,
    );
    expect(Number(v2.unitCostAtSale)).toBe(4.2);
  });

  it("tipo sem controle de estoque vende sem custo (nulo)", async () => {
    const tipo = await novoTipo("SemCusto");
    const v = await EmbalagensService.createSale(
      { packagingTypeId: tipo.id, saleDate: hoje, quantity: 2, unitPrice: 5 },
      ctx,
    );
    expect(v.unitCostAtSale).toBeNull();
  });
});

describe("Cancelar venda de embalagem (regra única de desfazer)", () => {
  async function vendaDe15(nome: string) {
    const tipo = await novoTipo(nome);
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 40, custoUnitario: 2 },
      ctx,
    );
    const venda = await EmbalagensService.createSale(
      { packagingTypeId: tipo.id, quantity: 15, unitPrice: 3, saleDate: isoDateTz(new Date()) },
      ctx,
    );
    return { tipo, venda };
  }

  it("marca a venda, devolve o saldo por ESTORNO e não apaga linha do livro-razão", async () => {
    const { tipo, venda } = await vendaDe15("Estorno");
    expect(await saldoDe(tipo.id)).toBe(25);

    await EmbalagensService.cancelarVenda({ id: venda.id, motivo: "quantidade errada" }, ctx);

    expect(await saldoDe(tipo.id)).toBe(40);
    const movs = await prisma.packagingMovement.findMany({
      where: { packagingTypeId: tipo.id },
      orderBy: { createdAt: "asc" },
    });
    // Saldo inicial, a baixa da venda e o estorno — nada apagado.
    expect(movs.map((m) => m.type)).toEqual(["AJUSTE", "SAIDA", "AJUSTE"]);
    // O estorno volta pelo custo com que saiu.
    expect(Number(movs[2]!.unitCost)).toBe(2);
    const marcada = await prisma.packagingSale.findUniqueOrThrow({ where: { id: venda.id } });
    expect(marcada.cancelledAt).toBeTruthy();
    expect(marcada.deletedAt).toBeNull();
  });

  it("sai dos totais do mês", async () => {
    const antes = await EmbalagensService.listSales(tenantId);
    const { venda } = await vendaDe15("Totais");
    await EmbalagensService.cancelarVenda({ id: venda.id }, ctx);
    const depois = await EmbalagensService.listSales(tenantId);
    expect(depois.total.toString()).toBe(antes.total.toString());
    expect(depois.vendas.find((v) => v.id === venda.id)?.podeCancelar).toBe(false);
  });

  it("recusa depois de 24 h, recusa cancelar duas vezes e só o dono cancela", async () => {
    const { venda } = await vendaDe15("Prazo");
    const outro = { ...ctx, session: { ...ctx.session, role: "STAFF" as never } };
    await expect(EmbalagensService.cancelarVenda({ id: venda.id }, outro)).rejects.toThrow(
      /responsável/,
    );
    await EmbalagensService.cancelarVenda({ id: venda.id }, ctx);
    await expect(EmbalagensService.cancelarVenda({ id: venda.id }, ctx)).rejects.toThrow(
      /já foi cancelada/,
    );

    const { venda: antiga } = await vendaDe15("Antiga");
    await prisma.packagingSale.update({
      where: { id: antiga.id },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await expect(EmbalagensService.cancelarVenda({ id: antiga.id }, ctx)).rejects.toThrow(
      /prazo/i,
    );
  });
});

/**
 * Corridas: dois aparelhos do mesmo box agindo ao mesmo tempo.
 *
 * O saldo era lido FORA da transação e sem trava, então duas vendas das últimas
 * unidades passavam as duas pela validação e o saldo ia a negativo. E ligar o
 * controle duas vezes juntas gravava dois AJUSTEs — o saldo nascia em dobro.
 */
describe("Concorrência no estoque de embalagens", () => {
  it("duas vendas simultâneas do saldo inteiro: só uma passa, o saldo não fica negativo", async () => {
    const tipo = await novoTipo("Corrida");
    await EmbalagensService.ativarControleEstoque(
      { packagingTypeId: tipo.id, quantidadeAtual: 10 },
      ctx,
    );
    const vender = () =>
      EmbalagensService.createSale(
        {
          packagingTypeId: tipo.id,
          quantity: 10,
          unitPrice: 1,
          saleDate: new Date().toISOString(),
          customerName: "Cliente",
        },
        ctx,
      );

    const r = await Promise.allSettled([vender(), vender(), vender()]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const recusas = r.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(recusas).toHaveLength(2);
    for (const x of recusas) expect(String(x.reason)).toMatch(/em estoque/);
    expect(await saldoDe(tipo.id)).toBe(0);
  });

  it("ligar o controle duas vezes ao mesmo tempo grava o saldo inicial uma vez só", async () => {
    const tipo = await novoTipo("Ligar2x");
    const ligar = () =>
      EmbalagensService.ativarControleEstoque(
        { packagingTypeId: tipo.id, quantidadeAtual: 50 },
        ctx,
      );

    const r = await Promise.allSettled([ligar(), ligar()]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await saldoDe(tipo.id)).toBe(50);
    expect(
      await prisma.packagingMovement.count({ where: { packagingTypeId: tipo.id, type: "AJUSTE" } }),
    ).toBe(1);
  });
});

describe("Saldo e totais que não quebram com volume", () => {
  it("soma acima de 2^31 não derruba o saldo (o cast era ::int)", async () => {
    const tipo = await novoTipo("Gigante");
    await prisma.packagingType.update({ where: { id: tipo.id }, data: { tracksStock: true } });
    await prisma.packagingMovement.createMany({
      data: [1_500_000_000, 1_500_000_000].map((quantity) => ({
        tenantId,
        packagingTypeId: tipo.id,
        type: "ENTRADA" as const,
        quantity,
      })),
    });
    expect(await saldoDe(tipo.id)).toBe(3_000_000_000);
  });

  it("os totais do mês somam TODAS as vendas do mês, não só as 100 da lista", async () => {
    const t = await createTestTenant("EMBALAGENS TOTAIS");
    tenants.push(t);
    const tipo = await prisma.packagingType.create({ data: { tenantId: t, name: "Caixa" } });
    const agora = new Date();
    await prisma.packagingSale.createMany({
      data: Array.from({ length: 120 }, () => ({
        tenantId: t,
        packagingTypeId: tipo.id,
        saleDate: agora,
        quantity: 2,
        unitPrice: 1.5,
        totalAmount: 3,
      })),
    });
    // Venda de outro mês: fica na lista (se couber), mas não no total do mês.
    await prisma.packagingSale.create({
      data: {
        tenantId: t,
        packagingTypeId: tipo.id,
        saleDate: new Date(agora.getTime() - 60 * 864e5),
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
      },
    });

    const { vendas, total, totalQtd } = await EmbalagensService.listSales(t, agora);
    expect(vendas).toHaveLength(100);
    expect(totalQtd).toBe(240);
    expect(total.toString()).toBe("360");

    await prisma.packagingSale.deleteMany({ where: { tenantId: t } });
    await prisma.packagingType.deleteMany({ where: { tenantId: t } });
  });
});
