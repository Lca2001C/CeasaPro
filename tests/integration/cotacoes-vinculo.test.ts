import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { slugProduto } from "@/lib/cotacoes/nome";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

/**
 * O módulo de cotações é quase todo dado PÚBLICO — o boletim da central é o
 * mesmo para todo mundo que compra ali, e por isso as tabelas de central,
 * produto e cotação nascem sem `tenantId`.
 *
 * A exceção é o VÍNCULO: qual produto do boletim corresponde ao produto de UMA
 * empresa. Essa é a única superfície do módulo onde vazar dado entre clientes é
 * possível, e é o que estes testes cobrem — junto com a regra de destaque, que é
 * a coisa que o usuário pediu.
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const CENTRAL = `TESTE${uniq().slice(0, 5)}`.toUpperCase();

const tenants: string[] = [];
const ceasaProdutos: string[] = [];
let tenantA = "";
let tenantB = "";
let produtoA = "";
let produtoB = "";
let tomateSalada = "";
let tomateCereja = "";
const HOJE = new Date();
HOJE.setUTCHours(0, 0, 0, 0);

async function criarProdutoDoBoletim(nome: string) {
  const p = await prisma.ceasaProduct.create({
    data: { name: nome, slug: `${slugProduto(nome)}-${uniq()}` },
  });
  ceasaProdutos.push(p.id);
  return p.id;
}

async function cotar(ceasaProductId: string, unit: string, refPrice: string) {
  await prisma.ceasaQuote.create({
    data: { centralCode: CENTRAL, ceasaProductId, quoteDate: HOJE, unit, refPrice },
  });
}

/** Dá saldo a um produto, pelo livro-razão — como o resto do sistema faz. */
async function entradaDeEstoque(tenantId: string, productId: string, qtd: string) {
  await prisma.stockMovement.create({
    data: {
      tenantId,
      productId,
      type: "ENTRADA",
      quantity: qtd,
      unitCost: "10.00",
      movedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  await prisma.ceasaCentral.create({
    data: {
      code: CENTRAL,
      name: "Central de Teste",
      city: "Contagem",
      uf: "MG",
      sourceKey: "manual",
    },
  });

  tenantA = await createTestTenant(`Empresa A ${uniq()}`);
  tenantB = await createTestTenant(`Empresa B ${uniq()}`);
  tenants.push(tenantA, tenantB);
  await prisma.tenant.updateMany({
    where: { id: { in: [tenantA, tenantB] } },
    data: { ceasaCentralCode: CENTRAL },
  });

  // As DUAS empresas têm um produto chamado "Tomate" — é o caso que expõe
  // vazamento se o vínculo não for isolado.
  const pa = await prisma.product.create({
    data: { tenantId: tenantA, name: "Tomate", saleUnit: "CAIXA" },
  });
  const pb = await prisma.product.create({
    data: { tenantId: tenantB, name: "Tomate", saleUnit: "CAIXA" },
  });
  produtoA = pa.id;
  produtoB = pb.id;

  tomateSalada = await criarProdutoDoBoletim("TOMATE SALADA LONGA VIDA");
  tomateCereja = await criarProdutoDoBoletim("TOMATE CEREJA");
  await cotar(tomateSalada, "CX 20KG", "85.00");
  await cotar(tomateCereja, "CX 10KG", "120.00");
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaProduct.deleteMany({ where: { id: { in: ceasaProdutos } } });
  await prisma.ceasaCentral.deleteMany({ where: { code: CENTRAL } });
});

describe("isolamento do vínculo", () => {
  it("o vínculo de uma empresa NÃO aparece para a outra", async () => {
    await CotacoesService.vincular(
      { productId: produtoA, ceasaProductId: tomateSalada },
      makeCtx(tenantA),
    );

    const painelA = await CotacoesService.getPainel(tenantA);
    const painelB = await CotacoesService.getPainel(tenantB);

    const saladaEmA = painelA.linhas.find((l) => l.ceasaProductId === tomateSalada)!;
    const saladaEmB = painelB.linhas.find((l) => l.ceasaProductId === tomateSalada)!;

    expect(saladaEmA.meuProdutoId).toBe(produtoA);
    // A empresa B tem um produto com o MESMO NOME e vê a mesma cotação pública,
    // mas não herda o vínculo de A.
    expect(saladaEmB.meuProdutoId).toBeNull();
    expect(saladaEmB.meuProdutoNome).toBeNull();
  });

  it("desvincular de uma empresa não mexe na outra", async () => {
    await CotacoesService.vincular(
      { productId: produtoB, ceasaProductId: tomateSalada },
      makeCtx(tenantB),
    );
    await CotacoesService.desvincular({ productId: produtoB }, makeCtx(tenantB));

    const painelA = await CotacoesService.getPainel(tenantA);
    expect(
      painelA.linhas.find((l) => l.ceasaProductId === tomateSalada)!.meuProdutoId,
    ).toBe(produtoA);
  });

  it("não dá para vincular produto de OUTRA empresa", async () => {
    // O id existe, só não é desta empresa. Sem a conferência contra o tenant,
    // isto criaria um vínculo cruzado.
    await expect(
      CotacoesService.vincular(
        { productId: produtoB, ceasaProductId: tomateCereja },
        makeCtx(tenantA),
      ),
    ).rejects.toThrow(/não encontrado/i);
  });

  it("revincular troca a cotação em vez de duplicar", async () => {
    await CotacoesService.vincular(
      { productId: produtoA, ceasaProductId: tomateCereja },
      makeCtx(tenantA),
    );
    const links = await prisma.tenantCeasaLink.findMany({
      where: { tenantId: tenantA, productId: produtoA },
    });
    expect(links).toHaveLength(1);
    expect(links[0]!.ceasaProductId).toBe(tomateCereja);

    // Devolve ao estado que os outros testes esperam.
    await CotacoesService.vincular(
      { productId: produtoA, ceasaProductId: tomateSalada },
      makeCtx(tenantA),
    );
  });
});

describe("destaque de quem tem estoque", () => {
  it("vinculado COM saldo é destacado; vinculado SEM saldo não é", async () => {
    // A vinculou "Tomate" ao salada nos testes acima, mas ainda não tem saldo.
    let painel = await CotacoesService.getPainel(tenantA);
    let salada = painel.linhas.find((l) => l.ceasaProductId === tomateSalada)!;
    expect(salada.meuProdutoId).toBe(produtoA);
    expect(Number(salada.meuSaldo)).toBe(0);

    await entradaDeEstoque(tenantA, produtoA, "12");

    painel = await CotacoesService.getPainel(tenantA);
    salada = painel.linhas.find((l) => l.ceasaProductId === tomateSalada)!;
    expect(Number(salada.meuSaldo)).toBe(12);
    expect(salada.meuProdutoNome).toBe("Tomate");
  });

  it("produto do boletim SEM vínculo continua na lista, só sem destaque", async () => {
    // "todos os produtos do ceasa" foi o pedido: o não vinculado não pode sumir.
    const painel = await CotacoesService.getPainel(tenantA);
    const cereja = painel.linhas.find((l) => l.ceasaProductId === tomateCereja);
    expect(cereja).toBeDefined();
    expect(cereja!.meuProdutoId).toBeNull();
    expect(Number(cereja!.refPrice)).toBe(120);
  });

  it("lista os produtos do cliente que ainda não têm cotação", async () => {
    const semCotacao = await prisma.product.create({
      data: { tenantId: tenantA, name: "Chuchu", saleUnit: "CAIXA" },
    });
    const painel = await CotacoesService.getPainel(tenantA);
    expect(painel.semVinculo.map((p) => p.id)).toContain(semCotacao.id);
    expect(painel.semVinculo.map((p) => p.id)).not.toContain(produtoA);
  });
});

describe("tela de vínculo", () => {
  /**
   * A tela só pode oferecer o que a central DA EMPRESA cota.
   *
   * Antes ela listava o catálogo global. Vincular a um produto de outra central
   * gravava o vínculo, e `getPainel` — que filtra por central — nunca achava
   * preço: o produto continuava como "sem cotação" para sempre, sem nada
   * explicando. Erro silencioso, que é o pior tipo neste módulo.
   */
  it("não oferece produto de central que a empresa não usa", async () => {
    const outraCentral = `OUT${uniq().slice(0, 5)}`.toUpperCase();
    await prisma.ceasaCentral.create({
      data: { code: outraCentral, name: "Outra", city: "Uberlandia", uf: "MG", sourceKey: "manual" },
    });
    const soDeLa = await criarProdutoDoBoletim("MANDIOCA SO DE UBERLANDIA");
    await prisma.ceasaQuote.create({
      data: {
        centralCode: outraCentral,
        ceasaProductId: soDeLa,
        quoteDate: HOJE,
        unit: "SC",
        refPrice: "60.00",
      },
    });

    const tela = await CotacoesService.getTelaDeVinculo(tenantA);
    const ofertados = tela.doBoletim.map((p) => p.id);
    expect(ofertados).toContain(tomateSalada); // da central dele
    expect(ofertados).not.toContain(soDeLa); // de outra central

    await prisma.ceasaQuote.deleteMany({ where: { centralCode: outraCentral } });
    await prisma.ceasaCentral.delete({ where: { code: outraCentral } });
  });

  it("sem central escolhida, não oferece nada em vez do catálogo inteiro", async () => {
    const semCentral = await createTestTenant(`Sem Central Vinculo ${uniq()}`);
    tenants.push(semCentral);
    const tela = await CotacoesService.getTelaDeVinculo(semCentral);
    expect(tela.doBoletim).toEqual([]);
  });

  it("sugere candidatos para produto sem vínculo, e nenhum para os já vinculados", async () => {
    const tela = await CotacoesService.getTelaDeVinculo(tenantA);
    const vinculado = tela.produtos.find((p) => p.id === produtoA)!;
    expect(vinculado.vinculo).not.toBeNull();
    expect(vinculado.sugestoes).toEqual([]);

    const chuchu = tela.produtos.find((p) => p.name === "Chuchu");
    if (chuchu) expect(chuchu.vinculo).toBeNull();
  });
});

describe("central da empresa", () => {
  it("sem central escolhida, a tela não mostra cotação de ninguém", async () => {
    const semCentral = await createTestTenant(`Empresa Sem Central ${uniq()}`);
    tenants.push(semCentral);

    const painel = await CotacoesService.getPainel(semCentral);
    expect(painel.central).toBeNull();
    expect(painel.linhas).toEqual([]);
  });

  it("central inexistente é recusada", async () => {
    await expect(
      CotacoesService.escolherCentral({ centralCode: "NAOEXISTE" }, makeCtx(tenantA)),
    ).rejects.toThrow(/não encontrada/i);
  });
});
