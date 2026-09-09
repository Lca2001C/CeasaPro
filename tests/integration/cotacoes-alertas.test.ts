import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { CotacoesAlertasService } from "@/lib/services/cotacoes-alertas.service";
import { AvisosService } from "@/lib/services/avisos.service";
import { slugProduto } from "@/lib/cotacoes/nome";
import { civilParts } from "@/lib/tz";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Alertas de flutuação: quando avisar, quando calar, e para quem.
 *
 * O que se testa aqui é o conjunto de decisões que fazem a diferença entre um
 * alarme e um incômodo. Um alerta que toca demais é desligado pelo usuário em
 * uma semana — e leva junto o aviso da alta de 30% que ele existe para pegar.
 * Por isso a maior parte destes testes afirma que o alerta NÃO dispara.
 */

const uniq = () => Math.random().toString(36).slice(2, 8);
const SUFIXO = uniq().toUpperCase();
const ATIVA = `ALA${SUFIXO}`.slice(0, 8);
const PARADA = `ALP${SUFIXO}`.slice(0, 8);

const BATATA = `BATATA TESTE ${SUFIXO}`;
const CEBOLA = `CEBOLA TESTE ${SUFIXO}`;
const MAMAO = `MAMAO TESTE ${SUFIXO}`;
const NOMES = [BATATA, CEBOLA, MAMAO];

const tenants: string[] = [];
let empresa = "";
let outraEmpresa = "";
let empresaParada = "";

function diasAtras(n: number): Date {
  const hoje = civilParts(new Date());
  return new Date(Date.UTC(hoje.year, hoje.month - 1, hoje.day - n));
}

const linha = (produto: string, unidade: string, referencia: number) => ({
  produto,
  unidade,
  minimo: null,
  comum: null,
  maximo: null,
  referencia,
});

const ctx = (tenantId: string): TenantCtx =>
  ({
    tenantId,
    userId: null,
    ip: null,
    session: { email: `alerta-${SUFIXO}@teste.com` },
  }) as unknown as TenantCtx;

async function idDoProduto(nome: string) {
  const p = await prisma.ceasaProduct.findFirstOrThrow({
    where: { slug: slugProduto(nome), serie: "CENTRAL" },
    select: { id: true },
  });
  return p.id;
}

beforeAll(async () => {
  await prisma.ceasaCentral.createMany({
    data: [
      {
        code: ATIVA,
        name: "Praça que publica",
        city: "Contagem",
        uf: "MG",
        sourceKey: "ceasaminas",
        maxDiasSemBoletim: 7,
      },
      {
        code: PARADA,
        name: "Praça que parou",
        city: "Barbacena",
        uf: "MG",
        sourceKey: "manual",
        maxDiasSemBoletim: 7,
      },
    ],
  });

  empresa = await createTestTenant("Alertas — empresa");
  outraEmpresa = await createTestTenant("Alertas — outra empresa");
  empresaParada = await createTestTenant("Alertas — praça parada");
  tenants.push(empresa, outraEmpresa, empresaParada);
  await prisma.tenant.updateMany({
    where: { id: { in: [empresa, outraEmpresa] } },
    data: { ceasaCentralCode: ATIVA },
  });
  await prisma.tenant.update({
    where: { id: empresaParada },
    data: { ceasaCentralCode: PARADA },
  });

  // Praça ativa: dois boletins recentes, com movimentos de tamanhos diferentes.
  await CotacoesImportService.gravar({
    centralCode: ATIVA,
    quoteDate: diasAtras(3),
    linhas: [
      linha(BATATA, "KG", 4.0),
      linha(CEBOLA, "KG", 5.0),
      linha(MAMAO, "KG", 3.0),
      // A mesma batata na caixa, para provar que a embalagem separa os alertas.
      linha(BATATA, "CX 20KG", 80.0),
    ],
    sourceKey: "ceasaminas",
  });
  await CotacoesImportService.gravar({
    centralCode: ATIVA,
    quoteDate: diasAtras(1),
    linhas: [
      linha(BATATA, "KG", 5.0), // +25%
      linha(CEBOLA, "KG", 5.1), // +2%, ruído para um limiar de 10%
      linha(MAMAO, "KG", 2.9), // −3,3%
      linha(BATATA, "CX 20KG", 81.0), // +1,25%
    ],
    sourceKey: "ceasaminas",
  });

  // Praça parada: último boletim MUITO velho, com um movimento grande dentro.
  await CotacoesImportService.gravar({
    centralCode: PARADA,
    quoteDate: diasAtras(60),
    linhas: [linha(BATATA, "KG", 4.0)],
    sourceKey: "ceasaminas",
  });
  await CotacoesImportService.gravar({
    centralCode: PARADA,
    quoteDate: diasAtras(40),
    linhas: [linha(BATATA, "KG", 8.0)], // +100%, mas de 40 dias atrás
    sourceKey: "ceasaminas",
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
  const centrais = [ATIVA, PARADA];
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: { in: centrais } } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: { in: centrais } } });
  await prisma.ceasaCentral.deleteMany({ where: { code: { in: centrais } } });
  await prisma.ceasaProduct.deleteMany({
    where: { slug: { in: NOMES.map((n) => slugProduto(n)) } },
  });
});

describe("quando o alerta dispara", () => {
  it("dispara acima do limiar e cala abaixo dele", async () => {
    const batata = await idDoProduto(BATATA);
    const cebola = await idDoProduto(CEBOLA);
    await CotacoesAlertasService.salvar(
      { ceasaProductId: batata, unit: "KG", variacaoMinima: 10, precoTeto: null, precoPiso: null },
      ctx(empresa),
    );
    await CotacoesAlertasService.salvar(
      { ceasaProductId: cebola, unit: "KG", variacaoMinima: 10, precoTeto: null, precoPiso: null },
      ctx(empresa),
    );

    const r = await CotacoesAlertasService.disparosDoBoletim(empresa);
    // Batata subiu 25% (dispara); cebola subiu 2% (não).
    expect(r!.disparos.map((d) => d.nome)).toEqual([BATATA]);
    expect(r!.disparos[0].motivos).toEqual(["alta"]);
  });

  it("o teto dispara mesmo sem movimento relevante", async () => {
    // O mamão caiu 3,3% — abaixo de qualquer limiar razoável. Mas o piso que a
    // empresa marcou foi atingido, e é essa a notícia.
    const mamao = await idDoProduto(MAMAO);
    await CotacoesAlertasService.salvar(
      { ceasaProductId: mamao, unit: "KG", variacaoMinima: 50, precoTeto: null, precoPiso: 3 },
      ctx(empresa),
    );
    const r = await CotacoesAlertasService.disparosDoBoletim(empresa);
    const doMamao = r!.disparos.find((d) => d.nome === MAMAO);
    expect(doMamao?.motivos).toEqual(["abaixo_do_piso"]);
    await CotacoesAlertasService.remover({ ceasaProductId: mamao, unit: "KG" }, ctx(empresa));
  });

  it("a embalagem separa os alertas", async () => {
    /*
      A batata subiu 25% no quilo e 1,25% na caixa — é o mesmo produto, e um
      alerta na caixa não pode herdar o movimento do quilo. Sem a unidade na
      chave, o comerciante receberia "a caixa subiu 25%", que é falso.
    */
    const batata = await idDoProduto(BATATA);
    await CotacoesAlertasService.salvar(
      { ceasaProductId: batata, unit: "CX 20KG", variacaoMinima: 10, precoTeto: null, precoPiso: null },
      ctx(empresa),
    );
    const r = await CotacoesAlertasService.disparosDoBoletim(empresa);
    const unidadesQueDispararam = r!.disparos.map((d) => d.unit);
    expect(unidadesQueDispararam).toContain("KG");
    expect(unidadesQueDispararam).not.toContain("CX 20KG");
    await CotacoesAlertasService.remover({ ceasaProductId: batata, unit: "CX 20KG" }, ctx(empresa));
  });
});

describe("quando o alerta CALA", () => {
  it("praça defasada não dispara, por mais forte que tenha sido o movimento", async () => {
    /*
      O teste que impede o alerta de virar ruído.

      A praça parada tem uma alta de 100% no último boletim — de 40 dias atrás.
      Sem este corte, esse "batata subiu 100%" entraria no resumo diário TODO
      DIA, para sempre, porque o "último boletim" nunca muda. Um alarme que toca
      todo dia é desligado em uma semana, e leva junto o aviso de verdade.

      O limiar é o da PRAÇA (`maxDiasSemBoletim`), não um número fixo.
    */
    const batata = await idDoProduto(BATATA);
    await CotacoesAlertasService.salvar(
      { ceasaProductId: batata, unit: "KG", variacaoMinima: 10, precoTeto: null, precoPiso: null },
      ctx(empresaParada),
    );
    const r = await CotacoesAlertasService.disparosDoBoletim(empresaParada);
    expect(r).toBeNull();
  });

  it("empresa sem alerta configurado não recebe nada", async () => {
    // `outraEmpresa` vê os mesmos preços — são públicos — mas não pediu aviso.
    expect(await CotacoesAlertasService.disparosDoBoletim(outraEmpresa)).toBeNull();
  });
});

describe("o alerta de uma empresa não vaza para outra", () => {
  it("cada empresa recebe só os seus disparos", async () => {
    const cebola = await idDoProduto(CEBOLA);
    // A outra empresa marca a cebola com um limiar frouxo o bastante para pegar
    // os 2% — movimento que NÃO dispara para a primeira.
    await CotacoesAlertasService.salvar(
      { ceasaProductId: cebola, unit: "KG", variacaoMinima: 1, precoTeto: null, precoPiso: null },
      ctx(outraEmpresa),
    );

    const minha = await CotacoesAlertasService.disparosDoBoletim(empresa);
    const dela = await CotacoesAlertasService.disparosDoBoletim(outraEmpresa);

    expect(minha!.disparos.map((d) => d.nome)).not.toContain(CEBOLA);
    expect(dela!.disparos.map((d) => d.nome)).toEqual([CEBOLA]);
  });

  it("remover o alerta de uma não mexe no da outra", async () => {
    const cebola = await idDoProduto(CEBOLA);
    await CotacoesAlertasService.remover({ ceasaProductId: cebola, unit: "KG" }, ctx(outraEmpresa));
    expect(await CotacoesAlertasService.disparosDoBoletim(outraEmpresa)).toBeNull();
    // A da primeira empresa (batata) continua de pé.
    const minha = await CotacoesAlertasService.disparosDoBoletim(empresa);
    expect(minha!.disparos.map((d) => d.nome)).toContain(BATATA);
  });
});

describe("salvar recusa alerta que nunca dispararia", () => {
  it("recusa produto que a praça da empresa não cota", async () => {
    // Um alerta gravado assim ficaria salvo, apareceria na tela e nunca tocaria:
    // um botão que não faz nada, sem nada explicando por quê.
    const fantasma = await prisma.ceasaProduct.create({
      data: { name: `FANTASMA ${SUFIXO}`, slug: `fantasma-alerta-${SUFIXO.toLowerCase()}`, serie: "CENTRAL" },
    });
    await expect(
      CotacoesAlertasService.salvar(
        { ceasaProductId: fantasma.id, unit: "KG", variacaoMinima: 10, precoTeto: null, precoPiso: null },
        ctx(empresa),
      ),
    ).rejects.toThrow(/não cota/i);
    await prisma.ceasaProduct.delete({ where: { id: fantasma.id } });
  });

  it("recusa embalagem que a praça não publica", async () => {
    const batata = await idDoProduto(BATATA);
    await expect(
      CotacoesAlertasService.salvar(
        { ceasaProductId: batata, unit: "SACO 50KG", variacaoMinima: 10, precoTeto: null, precoPiso: null },
        ctx(empresa),
      ),
    ).rejects.toThrow(/embalagem/i);
  });

  it("recusa produto da OUTRA taxonomia", async () => {
    const nacional = await prisma.ceasaProduct.create({
      data: { name: `GENERICO ${SUFIXO}`, slug: `generico-alerta-${SUFIXO.toLowerCase()}`, serie: "NACIONAL" },
    });
    await expect(
      CotacoesAlertasService.salvar(
        { ceasaProductId: nacional.id, unit: "KG", variacaoMinima: 10, precoTeto: null, precoPiso: null },
        ctx(empresa),
      ),
    ).rejects.toThrow();
    await prisma.ceasaProduct.delete({ where: { id: nacional.id } });
  });

  it("recusa piso acima do teto — os dois avisos tocariam em todo boletim", async () => {
    const batata = await idDoProduto(BATATA);
    await expect(
      CotacoesAlertasService.salvar(
        { ceasaProductId: batata, unit: "KG", variacaoMinima: 10, precoTeto: 3, precoPiso: 9 },
        ctx(empresa),
      ),
    ).rejects.toThrow(/piso/i);
  });

  it("salvar duas vezes reconfigura, não empilha", async () => {
    // Um duplo toque no botão criaria dois alertas iguais, e o comerciante
    // receberia o mesmo aviso duas vezes sem ter como saber por quê.
    const batata = await idDoProduto(BATATA);
    await CotacoesAlertasService.salvar(
      { ceasaProductId: batata, unit: "KG", variacaoMinima: 15, precoTeto: null, precoPiso: null },
      ctx(empresa),
    );
    const lista = await CotacoesAlertasService.listar(empresa);
    const daBatata = lista.filter((a) => a.nome === BATATA && a.unit === "KG");
    expect(daBatata).toHaveLength(1);
    expect(daBatata[0].variacaoMinima.toNumber()).toBe(15);
    // Volta ao limiar que o resto dos testes espera.
    await CotacoesAlertasService.salvar(
      { ceasaProductId: batata, unit: "KG", variacaoMinima: 10, precoTeto: null, precoPiso: null },
      ctx(empresa),
    );
  });
});

describe("o aviso que chega ao painel e à notificação", () => {
  it("entra como UM aviso agregado, e por último na lista", async () => {
    /*
      Duas regras num teste só, porque as duas quebram calado:

      1. UM aviso, não um por produto. O cartão do Início e a tela offline usam
         `key={aviso.tipo}` — um por produto produziria chaves repetidas no
         React e encheria a notificação diária com uma linha por item.
      2. Por ÚLTIMO. O push usa `avisos[0].href` como destino do toque; pôr
         cotação na frente tiraria de quem tem despesa vencida o atalho para a
         despesa.
    */
    const avisos = await AvisosService.get(empresa, ["cotacoes"]);
    const deCotacao = avisos.filter((a) => a.tipo === "cotacao_variacao");
    expect(deCotacao).toHaveLength(1);
    expect(avisos[avisos.length - 1].tipo).toBe("cotacao_variacao");
  });

  it("não traz dinheiro no campo de dinheiro — variação não é R$", async () => {
    // `total` passa por `formatBRL` em três telas. Um 25 aqui viraria "R$ 25,00"
    // com toda a naturalidade: um número plausível, do jeito errado.
    const avisos = await AvisosService.get(empresa, ["cotacoes"]);
    const cotacao = avisos.find((a) => a.tipo === "cotacao_variacao")!;
    expect(cotacao.total).toBeNull();
    // ...e o percentual está no texto, que é o que a notificação usa.
    expect(cotacao.label).toMatch(/%/);
    expect(cotacao.label).toContain("subiu");
  });

  it("some para quem não contratou o módulo", async () => {
    /*
      O Início NÃO é protegido por rota, então o gate tem de estar aqui. Sem ele
      a notificação levaria quem não contratou direto ao paywall — que é o
      oposto do que um aviso existe para fazer.
    */
    const semModulo = await AvisosService.get(empresa, []);
    expect(semModulo.some((a) => a.tipo === "cotacao_variacao")).toBe(false);
    // `isModuleEnabled` é fail-closed: sem a lista, também não aparece.
    const semLista = await AvisosService.get(empresa, undefined);
    expect(semLista.some((a) => a.tipo === "cotacao_variacao")).toBe(false);
  });
});

describe("produtos de interesse no Início", () => {
  it("junta o que a empresa vende e o que ela mandou vigiar", async () => {
    const mamao = await idDoProduto(MAMAO);
    const meuProduto = await prisma.product.create({
      data: { tenantId: empresa, name: "Mamão da casa", saleUnit: "KG" },
    });
    await prisma.tenantCeasaLink.create({
      data: { tenantId: empresa, productId: meuProduto.id, ceasaProductId: mamao },
    });

    const r = await CotacoesAlertasService.getInteresses(empresa);
    const nomes = r!.itens.map((i) => i.meuProdutoNome ?? i.nome);
    // O mamão entra pelo VÍNCULO (sem alerta); a batata, pelo ALERTA.
    expect(nomes).toContain("Mamão da casa");
    expect(r!.itens.some((i) => i.nome === BATATA && i.alerta !== null)).toBe(true);
  });

  it("ordena pelo movimento, não pelo nome", async () => {
    /*
      O cartão do Início mostra poucas linhas. Em ordem alfabética, a batata que
      subiu 25% ficaria atrás de qualquer coisa que comece com A e não mexeu.
    */
    const r = await CotacoesAlertasService.getInteresses(empresa);
    const variacoes = r!.itens.map((i) => Math.abs(i.variacao ?? 0));
    expect(variacoes).toEqual([...variacoes].sort((a, b) => b - a));
    expect(r!.itens[0].nome).toBe(BATATA);
  });

  it("não mostra item que sumiu do boletim mais recente", async () => {
    /*
      Um produto fora de safra some da publicação. Mostrá-lo no cartão com o
      preço do boletim anterior daria um número de outro dia com cara de hoje —
      exatamente o erro que o módulo inteiro existe para não cometer.
    */
    const sumido = await prisma.ceasaProduct.create({
      data: { name: `SUMIU ${SUFIXO}`, slug: `sumiu-${SUFIXO.toLowerCase()}`, serie: "CENTRAL" },
    });
    await prisma.ceasaQuote.create({
      data: {
        centralCode: ATIVA,
        ceasaProductId: sumido.id,
        quoteDate: diasAtras(3),
        unit: "KG",
        refPrice: 10,
      },
    });
    await prisma.tenantCeasaAlerta.create({
      data: { tenantId: empresa, ceasaProductId: sumido.id, unit: "KG", variacaoMinima: 5 },
    });

    const r = await CotacoesAlertasService.getInteresses(empresa);
    expect(r!.itens.map((i) => i.nome)).not.toContain(`SUMIU ${SUFIXO}`);

    await prisma.tenantCeasaAlerta.deleteMany({ where: { ceasaProductId: sumido.id } });
    await prisma.ceasaQuote.deleteMany({ where: { ceasaProductId: sumido.id } });
    await prisma.ceasaProduct.delete({ where: { id: sumido.id } });
  });
});
