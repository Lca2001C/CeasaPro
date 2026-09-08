import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { CotacoesHistoricoService } from "@/lib/services/cotacoes-historico.service";
import { slugProduto } from "@/lib/cotacoes/nome";
import { civilParts } from "@/lib/tz";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Histórico, média por mês e comparativo entre praças.
 *
 * O que se testa aqui não é "a consulta devolve linhas": é o conjunto de
 * decisões que erram CALADO, mostrando um número plausível pelo motivo errado —
 * comparar preços de dias diferentes como se fossem do mesmo dia, misturar
 * embalagens na mesma série, tratar estreia no boletim como preço estável, ou
 * deixar o vínculo de uma empresa aparecer na tela de outra.
 */

const uniq = () => Math.random().toString(36).slice(2, 8);
const SUFIXO = uniq().toUpperCase();
const MINHA = `HMI${SUFIXO}`.slice(0, 8);
const OUTRA = `HOU${SUFIXO}`.slice(0, 8);
const DESLIGADA = `HDE${SUFIXO}`.slice(0, 8);

// Nomes únicos por execução: o catálogo de produtos é GLOBAL, e reaproveitar um
// nome real faria a limpeza de um teste apagar dado de outro.
const TOMATE = `TOMATE TESTE ${SUFIXO}`;
const ABACAXI = `ABACAXI TESTE ${SUFIXO}`;
const SO_MEU = `PRODUTO SO DA MINHA PRACA ${SUFIXO}`;
const NOMES = [TOMATE, ABACAXI, SO_MEU];

const tenants: string[] = [];
let minhaEmpresa = "";
let outraEmpresa = "";

/** Meia-noite UTC de N dias atrás, contando o dia civil BRASILEIRO como hoje. */
function diasAtras(n: number): Date {
  const hoje = civilParts(new Date());
  return new Date(Date.UTC(hoje.year, hoje.month - 1, hoje.day - n));
}

const linha = (
  produto: string,
  unidade: string,
  referencia: number,
  faixa?: { minimo: number; maximo: number },
) => ({
  produto,
  unidade,
  minimo: faixa?.minimo ?? null,
  comum: null,
  maximo: faixa?.maximo ?? null,
  referencia,
});

async function gravarNaPraca(centralCode: string, quoteDate: Date, linhas: ReturnType<typeof linha>[]) {
  await CotacoesImportService.gravar({
    centralCode,
    quoteDate,
    linhas,
    sourceKey: "ceasaminas",
  });
}

beforeAll(async () => {
  await prisma.ceasaCentral.createMany({
    data: [
      {
        code: MINHA,
        name: "Praça da Empresa",
        city: "Contagem",
        uf: "MG",
        sourceKey: "ceasaminas",
        maxDiasSemBoletim: 3,
      },
      {
        code: OUTRA,
        name: "Praça Vizinha",
        city: "Uberlândia",
        uf: "MG",
        sourceKey: "ceasaminas",
        maxDiasSemBoletim: 7,
      },
      {
        code: DESLIGADA,
        name: "Praça Desativada",
        city: "Barbacena",
        uf: "MG",
        sourceKey: "ceasaminas",
        active: false,
      },
    ],
  });

  minhaEmpresa = await createTestTenant("Histórico — minha empresa");
  outraEmpresa = await createTestTenant("Histórico — outra empresa");
  tenants.push(minhaEmpresa, outraEmpresa);
  await prisma.tenant.updateMany({
    where: { id: { in: [minhaEmpresa, outraEmpresa] } },
    data: { ceasaCentralCode: MINHA },
  });

  /*
    A série do tomate na minha praça. Note o BURACO deliberado entre 12 e 2 dias
    atrás: é a cadência real de quem publica 2 a 3 vezes por semana, e é o que
    permite testar que "anterior" não quer dizer "ontem".
  */
  await gravarNaPraca(MINHA, diasAtras(40), [linha(TOMATE, "KG", 4.0)]);
  await gravarNaPraca(MINHA, diasAtras(12), [linha(TOMATE, "KG", 5.0)]);
  await gravarNaPraca(MINHA, diasAtras(2), [
    linha(TOMATE, "KG", 6.0, { minimo: 5, maximo: 7 }),
    // Mesma fruta, embalagem diferente e ordem de grandeza diferente.
    linha(TOMATE, "CX 20KG", 110.0),
    // Estreia: aparece só no boletim mais recente.
    linha(ABACAXI, "UN", 8.0),
    linha(SO_MEU, "KG", 3.0),
  ]);

  // A praça vizinha cota o mesmo tomate, em KG, mas o boletim dela é bem mais
  // velho — é o caso que o comparativo não pode esconder.
  await gravarNaPraca(OUTRA, diasAtras(30), [linha(TOMATE, "KG", 4.5)]);
  // ...e cota o abacaxi numa unidade DIFERENTE da minha.
  await gravarNaPraca(OUTRA, diasAtras(2), [linha(ABACAXI, "KG", 2.0)]);

  // Praça desligada do catálogo, com preço tentador.
  await gravarNaPraca(DESLIGADA, diasAtras(2), [linha(TOMATE, "KG", 1.0)]);
});

afterAll(async () => {
  await cleanupTenants(tenants);
  const centrais = [MINHA, OUTRA, DESLIGADA];
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: { in: centrais } } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: { in: centrais } } });
  await prisma.ceasaCentral.deleteMany({ where: { code: { in: centrais } } });
  await prisma.ceasaProduct.deleteMany({
    where: { slug: { in: NOMES.map((n) => slugProduto(n)) } },
  });
});

async function idDoProduto(nome: string) {
  const p = await prisma.ceasaProduct.findFirstOrThrow({
    where: { slug: slugProduto(nome), serie: "CENTRAL" },
    select: { id: true },
  });
  return p.id;
}

describe("painel: preço anterior e variação", () => {
  it("o anterior vem com a DATA dele — o cartão não pode dizer 'ontem'", async () => {
    /*
      O boletim anterior do tomate é o de 12 dias atrás, não o de ontem: a praça
      não publicou no intervalo. Um cartão escrito "Ontem: R$ 5,00" aqui faria o
      comerciante repassar como recente um preço de quase duas semanas.
    */
    const painel = await CotacoesService.getPainel(minhaEmpresa);
    const kg = painel.linhas.find((l) => l.ceasaProductName === TOMATE && l.unit === "KG");

    expect(kg?.anterior).not.toBeNull();
    expect(kg!.anterior!.refPrice.toNumber()).toBe(5);
    expect(kg!.anterior!.quoteDate.toISOString().slice(0, 10)).toBe(
      diasAtras(12).toISOString().slice(0, 10),
    );
    expect(kg!.variacao).toBeCloseTo(20); // de 5,00 para 6,00
  });

  it("produto que estreia no boletim não tem variação — e não tem 'zero por cento'", async () => {
    // Zero leria como "não mudou". A tela precisa distinguir "não mudou" de
    // "não sei", que é o caso de quem apareceu pela primeira vez hoje.
    const painel = await CotacoesService.getPainel(minhaEmpresa);
    const novo = painel.linhas.find((l) => l.ceasaProductName === ABACAXI);

    expect(novo?.anterior).toBeNull();
    expect(novo?.variacao).toBeNull();
  });

  it("a série do minigráfico é por produto E embalagem, sem misturar as duas", async () => {
    /*
      O tomate é cotado a R$ 6,00 o quilo e a R$ 110,00 a caixa. Juntar as duas
      séries desenharia um dente de serra de 1.700% que não existe no mercado —
      é troca de embalagem, não movimento de preço.
    */
    const painel = await CotacoesService.getPainel(minhaEmpresa);
    const kg = painel.linhas.find((l) => l.ceasaProductName === TOMATE && l.unit === "KG");
    const caixa = painel.linhas.find((l) => l.ceasaProductName === TOMATE && l.unit === "CX 20KG");

    // Os três boletins da praça cabem na janela de oito do minigráfico.
    expect(kg?.serie).toEqual([4, 5, 6]);
    expect(caixa?.serie).toEqual([110]);
    // A caixa estreou hoje nessa embalagem: sem anterior, sem variação.
    expect(caixa?.anterior).toBeNull();
  });
});

describe("histórico do produto", () => {
  it("a janela recorta pelo período pedido", async () => {
    const id = await idDoProduto(TOMATE);
    const trintaDias = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 30,
    });
    const umAno = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 365,
    });

    // O ponto de 40 dias atrás está fora de 30 dias e dentro de 365.
    expect(trintaDias!.pontos).toHaveLength(2);
    expect(umAno!.pontos).toHaveLength(3);
    expect(umAno!.pontos.map((p) => p.refPrice.toNumber())).toEqual([4, 5, 6]);
  });

  it("o resumo mede a janela, e a variação vai de ponta a ponta dela", async () => {
    const id = await idDoProduto(TOMATE);
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 365,
    });

    expect(h!.resumo!.minimo.toNumber()).toBe(4);
    expect(h!.resumo!.maximo.toNumber()).toBe(6);
    expect(h!.resumo!.media.toNumber()).toBeCloseTo(5);
    expect(h!.resumo!.variacaoNoPeriodo).toBeCloseTo(50); // de 4,00 para 6,00
  });

  it("mostra o último preço conhecido mesmo quando a janela está vazia", async () => {
    /*
      Produto fora de safra some do boletim por semanas. Se o "atual" viesse da
      janela, o filtro de 30 dias abriria a tela em branco e pareceria defeito do
      módulo em vez de ausência de oferta.
    */
    const id = await idDoProduto(TOMATE);
    // Uma janela onde só cabe o boletim de 2 dias atrás não pode zerar o atual.
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "CX 20KG",
      periodo: 30,
    });

    expect(h).not.toBeNull();
    expect(h!.atual.refPrice.toNumber()).toBe(110);
  });

  it("id de produto que a praça da empresa não cota devolve null, não tela vazia", async () => {
    const inventado = await prisma.ceasaProduct.create({
      data: { name: `FANTASMA ${SUFIXO}`, slug: `fantasma-${SUFIXO.toLowerCase()}`, serie: "CENTRAL" },
    });
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: inventado.id,
      unit: "KG",
      periodo: 90,
    });
    expect(h).toBeNull();
    await prisma.ceasaProduct.delete({ where: { id: inventado.id } });
  });

  it("produto da OUTRA taxonomia devolve null", async () => {
    // A praça publica a série da própria praça. Abrir um produto genérico da
    // série nacional daria uma tela com nome de um vocabulário e histórico vazio
    // do outro, sem nada explicando.
    const nacional = await prisma.ceasaProduct.create({
      data: { name: `GENERICO ${SUFIXO}`, slug: `generico-${SUFIXO.toLowerCase()}`, serie: "NACIONAL" },
    });
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: nacional.id,
      unit: "KG",
      periodo: 90,
    });
    expect(h).toBeNull();
    await prisma.ceasaProduct.delete({ where: { id: nacional.id } });
  });
});

describe("comparativo entre praças", () => {
  it("traz a data do boletim DE CADA praça, que quase nunca é a mesma", async () => {
    /*
      A regra que impede o comparativo de mentir por omissão. A vizinha está
      R$ 4,50 contra R$ 6,00 daqui — mas o boletim dela é de 30 dias atrás.
      Sem a data por linha, a diferença pareceria geografia quando é calendário.
    */
    const id = await idDoProduto(TOMATE);
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 90,
    });

    const vizinha = h!.comparativo.find((p) => p.centralCode === OUTRA);
    const minha = h!.comparativo.find((p) => p.centralCode === MINHA);

    expect(vizinha!.quoteDate.toISOString().slice(0, 10)).toBe(
      diasAtras(30).toISOString().slice(0, 10),
    );
    expect(minha!.quoteDate.toISOString().slice(0, 10)).toBe(
      diasAtras(2).toISOString().slice(0, 10),
    );
    expect(minha!.ehMinha).toBe(true);
    expect(vizinha!.ehMinha).toBe(false);
    // E o limiar de defasagem é o DA PRAÇA, não um número fixo.
    expect(minha!.maxDiasSemBoletim).toBe(3);
    expect(vizinha!.maxDiasSemBoletim).toBe(7);
  });

  it("ordena do mais barato para o mais caro", async () => {
    const id = await idDoProduto(TOMATE);
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 90,
    });
    const precos = h!.comparativo.map((p) => p.refPrice.toNumber());
    expect(precos).toEqual([...precos].sort((a, b) => a - b));
  });

  it("não compara embalagens diferentes", async () => {
    /*
      A vizinha cota abacaxi por QUILO; a minha praça, por UNIDADE. Pôr os dois
      lado a lado produziria uma "diferença de 300%" que é só embalagem.
    */
    const id = await idDoProduto(ABACAXI);
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "UN",
      periodo: 90,
    });

    expect(h!.comparativo.map((p) => p.centralCode)).toEqual([MINHA]);
  });

  it("praça desativada no catálogo fica de fora", async () => {
    // Catálogo desligado não é oferta: mostrar R$ 1,00 de uma praça que o
    // sistema não acompanha mais mandaria alguém dirigir atrás de um preço que
    // ninguém confere.
    const id = await idDoProduto(TOMATE);
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 90,
    });
    expect(h!.comparativo.map((p) => p.centralCode)).not.toContain(DESLIGADA);
  });

  it("produto de uma praça só não inventa comparação", async () => {
    const id = await idDoProduto(SO_MEU);
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 90,
    });
    expect(h!.comparativo).toHaveLength(1);
  });
});

describe("isolamento entre empresas", () => {
  it("o vínculo de uma empresa não aparece na tela da outra", async () => {
    /*
      O módulo é quase todo dado público, e `tenant_ceasa_links` é a ÚNICA
      superfície com dado de empresa. É por isso que o vazamento aqui seria
      fácil de não notar: as duas empresas veem legitimamente o mesmo preço, e
      só o "seu produto" as separa.
    */
    const id = await idDoProduto(TOMATE);
    const meuProduto = await prisma.product.create({
      data: { tenantId: minhaEmpresa, name: "Tomate da casa", saleUnit: "KG" },
    });
    await prisma.tenantCeasaLink.create({
      data: { tenantId: minhaEmpresa, productId: meuProduto.id, ceasaProductId: id },
    });

    const minha = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 90,
    });
    const dela = await CotacoesHistoricoService.getHistorico(outraEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 90,
    });

    expect(minha!.meuProduto?.name).toBe("Tomate da casa");
    expect(dela!.meuProduto).toBeNull();
    // ...e o preço público continua igual para as duas.
    expect(dela!.atual.refPrice.toNumber()).toBe(minha!.atual.refPrice.toNumber());
  });

  it("produto excluído não volta como 'seu produto' pelo vínculo sobrevivente", async () => {
    // O vínculo sobrevive ao soft delete do produto. Mostrá-lo ofereceria
    // estoque de um item que não existe mais no cadastro.
    const id = await idDoProduto(ABACAXI);
    const p = await prisma.product.create({
      data: { tenantId: minhaEmpresa, name: "Abacaxi apagado", saleUnit: "UNIDADE" },
    });
    await prisma.tenantCeasaLink.create({
      data: { tenantId: minhaEmpresa, productId: p.id, ceasaProductId: id },
    });
    await prisma.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });

    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "UN",
      periodo: 90,
    });
    expect(h!.meuProduto).toBeNull();
  });
});

describe("média por mês", () => {
  it("some enquanto não há meses suficientes, em vez de desenhar safra com 3 pontos", async () => {
    /*
      Um comerciante que vê "média por mês" desenhada com três meses conclui
      coisa sobre safra a partir de três pontos — e compra caminhão com isso.
      Abaixo do limiar a seção não existe, e a tela diz que ainda está juntando.
    */
    const id = await idDoProduto(TOMATE);
    const h = await CotacoesHistoricoService.getHistorico(minhaEmpresa, {
      ceasaProductId: id,
      unit: "KG",
      periodo: 365,
    });

    expect(h!.mesesComDado).toBeLessThan(6);
    expect(h!.mediaPorMes).toEqual([]);
  });
});
