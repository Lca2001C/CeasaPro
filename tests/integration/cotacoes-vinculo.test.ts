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
/** Toda central criada por qualquer teste deste arquivo — limpa no afterAll. */
const centraisCriadas: string[] = [CENTRAL];

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
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: { in: centraisCriadas } } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: { in: centraisCriadas } } });
  await prisma.ceasaProduct.deleteMany({ where: { id: { in: ceasaProdutos } } });
  await prisma.ceasaCentral.deleteMany({ where: { code: { in: centraisCriadas } } });
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
    // Registrado ANTES de criar: a limpeza mora no `afterAll` porque limpeza
    // dentro do corpo do teste não roda quando a asserção falha — e aí um teste
    // vermelho deixa lixo no banco que faz o PRÓXIMO teste falhar por outro
    // motivo. Foi o que aconteceu aqui de verdade.
    centraisCriadas.push(outraCentral);
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

/**
 * A EMBALAGEM no vínculo.
 *
 * O boletim cota o mesmo item em embalagens de ordem de grandeza diferente — a
 * batata sai por quilo e em caixa de 20 kg na mesma publicação. Sem embalagem no
 * vínculo, TODOS os cartões daquele item se marcavam como "Você vende", e a
 * seção "Produtos que você vende" vinha com o dobro de linhas que o cliente
 * reconhece como dele.
 */
describe("embalagem do vínculo", () => {
  let batata = "";
  let batataDoCliente = "";
  let outroTenant = "";

  beforeAll(async () => {
    batata = await criarProdutoDoBoletim(`BATATA LISA ${uniq()}`);
    await cotar(batata, "KG", "4.20");
    await cotar(batata, "CX 20 KG", "84.00");

    outroTenant = await createTestTenant(`Empresa Embalagem ${uniq()}`);
    tenants.push(outroTenant);
    await prisma.tenant.update({
      where: { id: outroTenant },
      data: { ceasaCentralCode: CENTRAL },
    });
    const p = await prisma.product.create({
      data: { tenantId: outroTenant, name: "Batata", saleUnit: "CAIXA" },
    });
    batataDoCliente = p.id;
  });

  it("vínculo na caixa marca a caixa e NÃO marca o quilo", async () => {
    await CotacoesService.vincular(
      { productId: batataDoCliente, ceasaProductId: batata, unit: "CX 20 KG" },
      makeCtx(outroTenant),
    );

    const painel = await CotacoesService.getPainel(outroTenant);
    const daBatata = painel.linhas.filter((l) => l.ceasaProductId === batata);
    const caixa = daBatata.find((l) => l.unit === "CX 20 KG")!;
    const quilo = daBatata.find((l) => l.unit === "KG")!;

    expect(caixa.vinculo).toBe("exato");
    expect(caixa.minhaEmbalagem).toBe("CX 20 KG");

    /*
      A linha do quilo não é destaque, mas também não é anônima: ela continua
      dizendo que este item é do cliente e em que embalagem ele o compra. É o que
      responde "minha batata está a R$ 84 a caixa E a R$ 4,20 o quilo".
    */
    expect(quilo.vinculo).toBe("outra_embalagem");
    expect(quilo.minhaEmbalagem).toBe("CX 20 KG");
  });

  it("vínculo SEM embalagem escolhida vale para todas — é o que os antigos herdaram", async () => {
    await CotacoesService.vincular(
      { productId: batataDoCliente, ceasaProductId: batata, unit: null },
      makeCtx(outroTenant),
    );

    const painel = await CotacoesService.getPainel(outroTenant);
    const daBatata = painel.linhas.filter((l) => l.ceasaProductId === batata);
    expect(daBatata).toHaveLength(2);
    expect(daBatata.every((l) => l.vinculo === "exato")).toBe(true);
    expect(daBatata.every((l) => l.minhaEmbalagem === null)).toBe(true);
  });

  it("trocar de item NÃO herda a embalagem do vínculo anterior", async () => {
    // `undefined` no update do Prisma significa "não mexa": sem passar `null`
    // explicitamente, o vínculo novo ficaria com a embalagem do antigo — que pode
    // não existir no item novo, e aí o produto sairia da tela sem ninguém pedir.
    await CotacoesService.vincular(
      { productId: batataDoCliente, ceasaProductId: batata, unit: "CX 20 KG" },
      makeCtx(outroTenant),
    );
    await CotacoesService.vincular(
      { productId: batataDoCliente, ceasaProductId: batata },
      makeCtx(outroTenant),
    );
    const link = await prisma.tenantCeasaLink.findFirstOrThrow({
      where: { tenantId: outroTenant, productId: batataDoCliente },
    });
    expect(link.unit).toBeNull();
  });

  it("recusa embalagem que a praça não publica", async () => {
    await expect(
      CotacoesService.vincular(
        { productId: batataDoCliente, ceasaProductId: batata, unit: "SC 60 KG" },
        makeCtx(outroTenant),
      ),
    ).rejects.toThrow(/não cota este produto nesta embalagem/i);
  });

  /**
   * Este reprova sem a correção: `vincular` conferia só "o produto é meu" e "o
   * item existe no catálogo GLOBAL". A auditoria de 07/09 corrigiu isso na TELA,
   * mas a Server Action é um POST e não passa pela tela.
   */
  it("recusa item de outra taxonomia, que nunca teria preço nesta praça", async () => {
    const nacional = await prisma.ceasaProduct.create({
      data: { name: `CEBOLA NACIONAL ${uniq()}`, slug: `cebola-nac-${uniq()}`, serie: "NACIONAL" },
    });
    ceasaProdutos.push(nacional.id);

    await expect(
      CotacoesService.vincular(
        { productId: batataDoCliente, ceasaProductId: nacional.id },
        makeCtx(outroTenant),
      ),
    ).rejects.toThrow(/não é cotado pela sua central/i);
  });

  /**
   * Também reprova sem a correção, e o defeito é ANTERIOR à embalagem.
   *
   * A chave única é (tenantId, productId), então dois produtos meus podem
   * apontar para o mesmo item do boletim — o schema documenta isso. Com LEFT
   * JOIN comum, esses dois vínculos multiplicavam a linha da cotação: dois
   * cartões idênticos na tela e chaves React duplicadas na grade.
   */
  it("dois produtos meus no mesmo item do boletim geram UMA linha por embalagem", async () => {
    const segundo = await prisma.product.create({
      data: { tenantId: outroTenant, name: "Batata em caixa", saleUnit: "CAIXA" },
    });
    await CotacoesService.vincular(
      { productId: batataDoCliente, ceasaProductId: batata, unit: "KG" },
      makeCtx(outroTenant),
    );
    await CotacoesService.vincular(
      { productId: segundo.id, ceasaProductId: batata, unit: "CX 20 KG" },
      makeCtx(outroTenant),
    );

    const painel = await CotacoesService.getPainel(outroTenant);
    const daBatata = painel.linhas.filter((l) => l.ceasaProductId === batata);
    expect(daBatata).toHaveLength(2);

    // E cada linha aponta para o produto CERTO, não para um dos dois ao acaso.
    expect(daBatata.find((l) => l.unit === "KG")!.meuProdutoId).toBe(batataDoCliente);
    expect(daBatata.find((l) => l.unit === "CX 20 KG")!.meuProdutoId).toBe(segundo.id);

    await CotacoesService.desvincular({ productId: segundo.id }, makeCtx(outroTenant));
    await prisma.product.delete({ where: { id: segundo.id } });
  });

  /**
   * O único jeito de a embalagem no vínculo PIORAR a tela: a praça publica só o
   * quilo no dia, e o produto de quem escolheu a caixa não está nem em
   * `semVinculo` (tem vínculo) nem nas linhas (nada casou). Sem aviso, ele
   * desaparece sem uma palavra.
   */
  it("embalagem vinculada que não saiu no boletim é NOMEADA, não sumida", async () => {
    const soHoje = await criarProdutoDoBoletim(`ALHO ${uniq()}`);
    await cotar(soHoje, "KG", "30.00");
    const meuAlho = await prisma.product.create({
      data: { tenantId: outroTenant, name: "Alho", saleUnit: "KG" },
    });
    // Vincula a uma embalagem que existe no histórico mas não no boletim de hoje.
    await prisma.tenantCeasaLink.create({
      data: {
        tenantId: outroTenant,
        productId: meuAlho.id,
        ceasaProductId: soHoje,
        unit: "CX 10 KG",
      },
    });

    const painel = await CotacoesService.getPainel(outroTenant);
    const orfao = painel.vinculosSemCotacao.find((v) => v.produtoId === meuAlho.id);
    expect(orfao).toBeDefined();
    expect(orfao!.unit).toBe("CX 10 KG");
    expect(painel.semVinculo.map((p) => p.id)).not.toContain(meuAlho.id);

    // E o módulo continua sabendo que esta empresa tem vínculos — senão a tela
    // abriria em "Todos" e a seção verde desapareceria inteira.
    expect(painel.temVinculo).toBe(true);
  });

  it("a tela de vínculo oferece as embalagens de cada item, com escore", async () => {
    const tela = await CotacoesService.getTelaDeVinculo(outroTenant);
    const item = tela.doBoletim.find((c) => c.id === batata)!;
    expect(item.unidades).toEqual(["CX 20 KG", "KG"]);

    const semVinculo = tela.produtos.find((p) => p.vinculo === null);
    if (semVinculo) {
      for (const s of semVinculo.sugestoes) {
        expect(typeof s.escore).toBe("number");
        expect(s.escore).toBeGreaterThan(0);
      }
    }
  });

  it("trocar de praça devolve os vínculos a 'qualquer embalagem'", async () => {
    /*
      `CeasaProduct` é catálogo global justamente para o vínculo sobreviver à
      troca de central quando o nome coincide — está escrito no schema. A praça
      nova pode cotar o mesmo item como `CX 18 KG`, e aí a embalagem antiga não
      casa mais: o vínculo sobreviveria como carcaça. Zerar preserva a garantia.
    */
    const migrante = await createTestTenant(`Empresa Migrante ${uniq()}`);
    tenants.push(migrante);
    const destino = `MIG${uniq().slice(0, 5)}`.toUpperCase();
    centraisCriadas.push(destino);
    await prisma.ceasaCentral.create({
      data: { code: destino, name: "Destino", city: "Betim", uf: "MG", sourceKey: "manual" },
    });

    await CotacoesService.escolherCentral({ centralCode: CENTRAL }, makeCtx(migrante));
    const p = await prisma.product.create({
      data: { tenantId: migrante, name: "Batata", saleUnit: "CAIXA" },
    });
    await CotacoesService.vincular(
      { productId: p.id, ceasaProductId: batata, unit: "CX 20 KG" },
      makeCtx(migrante),
    );

    await CotacoesService.escolherCentral({ centralCode: destino }, makeCtx(migrante));

    const link = await prisma.tenantCeasaLink.findFirstOrThrow({
      where: { tenantId: migrante, productId: p.id },
    });
    expect(link.unit).toBeNull();
    // O vínculo em si SOBREVIVE — é a propriedade que o schema promete.
    expect(link.ceasaProductId).toBe(batata);
  });
});

describe("quantos produtos sem vínculo já têm nome exato no boletim", () => {
  let contaTenant = "";

  beforeAll(async () => {
    contaTenant = await createTestTenant(`Empresa Contagem ${uniq()}`);
    tenants.push(contaTenant);
    await prisma.tenant.update({
      where: { id: contaTenant },
      data: { ceasaCentralCode: CENTRAL },
    });
  });

  it("conta só o nome IDÊNTICO, não o parecido", async () => {
    /*
      A distinção é a razão do número existir. "Abobrinha" e "ABOBRINHA" são o
      mesmo produto — o slug normalizado é igual, e o vínculo sai em um clique.
      "Tomate" e "TOMATE SALADA LONGA VIDA" compartilham prefixo e NÃO são o
      mesmo preço: contar esse como "nome exato" seria prometer na tela um clique
      que na verdade é uma decisão.
    */
    const nome = `ABOBRINHA ${uniq()}`.toUpperCase();
    const doBoletim = await criarProdutoDoBoletim(nome);
    await cotar(doBoletim, "KG", "3.00");

    // Nome idêntico ao do boletim (a normalização ignora caixa e acento).
    await prisma.product.create({
      data: { tenantId: contaTenant, name: nome.toLowerCase(), saleUnit: "KG" },
    });
    // Só parecido: prefixo comum com o tomate criado no beforeAll do arquivo.
    await prisma.product.create({
      data: { tenantId: contaTenant, name: "Tomate", saleUnit: "CAIXA" },
    });

    const painel = await CotacoesService.getPainel(contaTenant);
    expect(painel.semVinculo).toHaveLength(2);
    expect(painel.semVinculoComNomeIdentico).toBe(1);
  });

  it("sem boletim, o número é zero em vez de uma promessa", async () => {
    const semBoletim = await createTestTenant(`Empresa Sem Boletim ${uniq()}`);
    tenants.push(semBoletim);
    const vazia = `VAZ${uniq().slice(0, 5)}`.toUpperCase();
    centraisCriadas.push(vazia);
    await prisma.ceasaCentral.create({
      data: { code: vazia, name: "Praca Vazia", city: "Ipatinga", uf: "MG", sourceKey: "manual" },
    });
    await prisma.tenant.update({
      where: { id: semBoletim },
      data: { ceasaCentralCode: vazia },
    });
    await prisma.product.create({
      data: { tenantId: semBoletim, name: "Cebola", saleUnit: "KG" },
    });

    const painel = await CotacoesService.getPainel(semBoletim);
    expect(painel.quoteDate).toBeNull();
    expect(painel.semVinculo).toHaveLength(1);
    expect(painel.semVinculoComNomeIdentico).toBe(0);
  });
});

describe("vínculo em lote", () => {
  let loteTenant = "";
  let itemA = "";
  let itemB = "";

  beforeAll(async () => {
    loteTenant = await createTestTenant(`Empresa Lote ${uniq()}`);
    tenants.push(loteTenant);
    await prisma.tenant.update({
      where: { id: loteTenant },
      data: { ceasaCentralCode: CENTRAL },
    });
    itemA = await criarProdutoDoBoletim(`CENOURA ${uniq()}`);
    itemB = await criarProdutoDoBoletim(`BETERRABA ${uniq()}`);
    await cotar(itemA, "KG", "3.50");
    await cotar(itemB, "KG", "2.80");
  });

  it("grava a lista inteira numa vez", async () => {
    const p1 = await prisma.product.create({
      data: { tenantId: loteTenant, name: "Cenoura", saleUnit: "KG" },
    });
    const p2 = await prisma.product.create({
      data: { tenantId: loteTenant, name: "Beterraba", saleUnit: "KG" },
    });

    const r = await CotacoesService.vincularEmLote(
      {
        itens: [
          { productId: p1.id, ceasaProductId: itemA, unit: "KG" },
          { productId: p2.id, ceasaProductId: itemB, unit: null },
        ],
      },
      makeCtx(loteTenant),
    );
    expect(r.vinculados).toBe(2);

    const links = await prisma.tenantCeasaLink.findMany({ where: { tenantId: loteTenant } });
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.productId === p1.id)!.unit).toBe("KG");
    expect(links.find((l) => l.productId === p2.id)!.unit).toBeNull();
  });

  it("um item inválido recusa o LOTE INTEIRO, sem gravar metade", async () => {
    /*
      Meio-lote gravado é pior que erro: o cliente confirmou 3 e não tem como
      saber onde parou. "Confirmei 3, apareceram 2" não tem explicação possível
      na tela.
    */
    const antes = await prisma.tenantCeasaLink.count({ where: { tenantId: loteTenant } });
    const novo = await prisma.product.create({
      data: { tenantId: loteTenant, name: "Chuchu do lote", saleUnit: "KG" },
    });

    await expect(
      CotacoesService.vincularEmLote(
        {
          itens: [
            { productId: novo.id, ceasaProductId: itemA, unit: "KG" },
            { productId: novo.id, ceasaProductId: itemB, unit: "EMBALAGEM QUE NAO EXISTE" },
          ],
        },
        makeCtx(loteTenant),
      ),
    ).rejects.toThrow(/duas vezes|não cota/i);

    expect(await prisma.tenantCeasaLink.count({ where: { tenantId: loteTenant } })).toBe(antes);
  });

  it("não vincula produto de outra empresa nem no meio de um lote válido", async () => {
    const antes = await prisma.tenantCeasaLink.count({ where: { tenantId: loteTenant } });
    await expect(
      CotacoesService.vincularEmLote(
        { itens: [{ productId: produtoA, ceasaProductId: itemA, unit: "KG" }] },
        makeCtx(loteTenant),
      ),
    ).rejects.toThrow(/não encontrado/i);
    expect(await prisma.tenantCeasaLink.count({ where: { tenantId: loteTenant } })).toBe(antes);
  });

  it("o lote deixa UM registro de auditoria, não um por produto", async () => {
    // `/atividades` é a lista que o dono do box lê. Quarenta linhas iguais no
    // mesmo minuto afogariam a venda e o fiado do dia dele.
    const p = await prisma.product.create({
      data: { tenantId: loteTenant, name: "Auditoria do lote", saleUnit: "KG" },
    });
    const antes = await prisma.auditLog.count({
      where: { tenantId: loteTenant, entity: "TenantCeasaLink" },
    });
    await CotacoesService.vincularEmLote(
      { itens: [{ productId: p.id, ceasaProductId: itemA, unit: "KG" }] },
      makeCtx(loteTenant),
    );
    const depois = await prisma.auditLog.count({
      where: { tenantId: loteTenant, entity: "TenantCeasaLink" },
    });
    expect(depois - antes).toBe(1);
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
