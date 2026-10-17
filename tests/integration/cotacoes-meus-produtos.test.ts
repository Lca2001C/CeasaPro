import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { slugProduto } from "@/lib/cotacoes/nome";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * "Produtos que você vende" no topo das Cotações: TODO produto ativo, do mais
 * vendido para o menos vendido — inclusive o que não saiu no boletim de hoje
 * (com o último preço e a data) e o que não tem vínculo.
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const CENTRAL = `MEUS${uniq().slice(0, 5)}`.toUpperCase();
const tenants: string[] = [];
const ceasaProdutos: string[] = [];
let tenantA = "";
let tenantB = "";
const ids: Record<string, string> = {};

const dia = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

async function produto(tenantId: string, name: string) {
  const p = await prisma.product.create({ data: { tenantId, name, saleUnit: "CAIXA" } });
  return p.id;
}

async function itemDoBoletim(nome: string) {
  const p = await prisma.ceasaProduct.create({
    data: { name: nome, slug: `${slugProduto(nome)}-${uniq()}` },
  });
  ceasaProdutos.push(p.id);
  return p.id;
}

async function vender(tenantId: string, productId: string, vezes: number) {
  for (let i = 0; i < vezes; i++) {
    await prisma.sale.create({
      data: {
        tenantId,
        paymentMethod: "DINHEIRO",
        totalAmount: "10.00",
        items: {
          create: {
            tenantId,
            productId,
            quantity: "1",
            unitPrice: "10.00",
            lineTotal: "10.00",
          },
        },
      },
    });
  }
}

beforeAll(async () => {
  await prisma.ceasaCentral.create({
    data: { code: CENTRAL, name: "Central Meus", city: "Contagem", uf: "MG", sourceKey: "manual" },
  });
  tenantA = await createTestTenant(`Meus A ${uniq()}`);
  tenantB = await createTestTenant(`Meus B ${uniq()}`);
  tenants.push(tenantA, tenantB);
  await prisma.tenant.updateMany({
    where: { id: { in: [tenantA, tenantB] } },
    data: { ceasaCentralCode: CENTRAL },
  });

  ids.alface = await produto(tenantA, "Alface Crespa");
  ids.batata = await produto(tenantA, "Batata Lavada");
  ids.cenoura = await produto(tenantA, "Cenoura Extra");
  ids.mandioquinha = await produto(tenantA, "Mandioquinha");
  ids.batataB = await produto(tenantB, "Batata Lavada");

  ids.boletimBatata = await itemDoBoletim("BATATA LAVADA ESPECIAL");
  ids.boletimCenoura = await itemDoBoletim("CENOURA EXTRA AA");
  // Batata saiu HOJE; cenoura só há 5 dias.
  await prisma.ceasaQuote.createMany({
    data: [
      { centralCode: CENTRAL, ceasaProductId: ids.boletimBatata, quoteDate: dia(0), unit: "SC 50 KG", refPrice: "150.00" },
      { centralCode: CENTRAL, ceasaProductId: ids.boletimCenoura, quoteDate: dia(5), unit: "CX 20 KG", refPrice: "60.00" },
      { centralCode: CENTRAL, ceasaProductId: ids.boletimCenoura, quoteDate: dia(9), unit: "CX 20 KG", refPrice: "55.00" },
    ],
  });
  await CotacoesService.vincular({ productId: ids.batata, ceasaProductId: ids.boletimBatata }, makeCtx(tenantA));
  await CotacoesService.vincular({ productId: ids.cenoura, ceasaProductId: ids.boletimCenoura }, makeCtx(tenantA));

  // Cenoura é a que mais gira; alface vende pouco; batata e mandioquinha, nada.
  await vender(tenantA, ids.cenoura, 3);
  await vender(tenantA, ids.alface, 1);
  // A empresa B vende muita batata — não pode mexer na ordem da A.
  await vender(tenantB, ids.batataB, 10);
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaProduct.deleteMany({ where: { id: { in: ceasaProdutos } } });
  await prisma.ceasaCentral.deleteMany({ where: { code: CENTRAL } });
});

describe("getMeusProdutos", () => {
  it("traz TODO produto ativo, do mais vendido para o menos vendido, e depois por nome", async () => {
    const meus = await CotacoesService.getMeusProdutos(tenantA);
    expect(meus.map((m) => m.nome)).toEqual([
      "Cenoura Extra",
      "Alface Crespa",
      "Batata Lavada",
      "Mandioquinha",
    ]);
  });

  it("produto fora do boletim de hoje traz o ÚLTIMO preço com a data dele", async () => {
    const cenoura = (await CotacoesService.getMeusProdutos(tenantA)).find((m) => m.produtoId === ids.cenoura)!;
    expect(cenoura.vinculo?.ceasaProductName).toBe("CENOURA EXTRA AA");
    expect(cenoura.ultimo?.refPrice.toString()).toBe("60");
    expect(cenoura.ultimo?.quoteDate.toISOString().slice(0, 10)).toBe(dia(5).toISOString().slice(0, 10));
  });

  it("produto sem vínculo aparece, sem vínculo e sem preço", async () => {
    const alface = (await CotacoesService.getMeusProdutos(tenantA)).find((m) => m.produtoId === ids.alface)!;
    expect(alface.vinculo).toBeNull();
    expect(alface.ultimo).toBeNull();
  });

  it("vendas e vínculos de uma empresa não aparecem para a outra", async () => {
    const meusB = await CotacoesService.getMeusProdutos(tenantB);
    expect(meusB.map((m) => m.produtoId)).toEqual([ids.batataB]);
    // B tem o mesmo nome que a batata vinculada da A, mas não herda o vínculo.
    expect(meusB[0]!.vinculo).toBeNull();
  });

  it("produto inativo ou excluído não entra", async () => {
    await prisma.product.update({ where: { id: ids.mandioquinha }, data: { active: false } });
    const meus = await CotacoesService.getMeusProdutos(tenantA);
    expect(meus.some((m) => m.produtoId === ids.mandioquinha)).toBe(false);
  });
});
