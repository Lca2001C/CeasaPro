import type { CeasaSerie, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { civilParts } from "@/lib/tz";
import { variacaoPercentual } from "@/lib/cotacoes/variacao";
import { serieDaFonte } from "./cotacoes-import.service";

/**
 * A tela de UM produto: histórico, médias por mês e o preço nas outras praças.
 *
 * Leitura pura, sem escrita e sem `audit` — não há o que auditar em consulta de
 * dado público. O escopo de empresa entra por dois caminhos, e só por eles: a
 * praça que a empresa escolheu (`tenant.ceasaCentralCode`) e o vínculo dela
 * (`tenant_ceasa_links`). O resto da tabela é o mesmo preço para todo mundo que
 * compra ali, como em `cotacoes.service.ts`.
 */

/**
 * Janelas oferecidas na tela.
 *
 * Trinta dias é a decisão de compra da semana; noventa pega a virada de safra;
 * trezentos e sessenta e cinco é o ciclo agrícola inteiro, que é o único
 * horizonte em que "época boa de comprar" quer dizer alguma coisa.
 */
export const PERIODOS_DE_HISTORICO = [30, 90, 365] as const;
export type PeriodoDeHistorico = (typeof PERIODOS_DE_HISTORICO)[number];
export const PERIODO_PADRAO: PeriodoDeHistorico = 90;

/**
 * Quantos meses distintos precisam ter dado antes de a tela desenhar a média
 * por mês.
 *
 * Não é limiar estético. Um comerciante que vê "média por mês" desenhada com
 * três meses de dado conclui coisa sobre safra a partir de três pontos — e
 * decide compra de caminhão com isso. Abaixo de seis meses a seção some, e a
 * tela diz que ainda está juntando histórico, que é a verdade: o módulo começa
 * a acumular no dia em que a empresa contrata.
 *
 * Mesmo com doze meses cheios, o que existe ali é UM ciclo. Um ciclo não é
 * sazonalidade — é o ano passado. É por isso que o título da seção diz "média
 * por mês" e não "sazonalidade", e que o rodapé conta quantos boletins entraram
 * em cada média.
 */
export const MESES_MINIMOS_PARA_MEDIA_MENSAL = 6;

export interface PontoDoHistorico {
  quoteDate: Date;
  refPrice: Prisma.Decimal;
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
}

export interface MediaDoMes {
  /** 1-12. */
  mes: number;
  media: Prisma.Decimal;
  /** Quantos boletins entraram nesta média — a tela precisa mostrar. */
  amostras: number;
}

export interface PracaComparada {
  centralCode: string;
  name: string;
  city: string;
  uf: string;
  /**
   * A data do boletim DESTA praça, que quase nunca é a mesma das outras.
   *
   * Sem ela o comparativo mente por omissão: alinhar o preço de hoje de Contagem
   * ao preço de 40 dias atrás de outra praça, na mesma coluna, faz a diferença
   * parecer geografia quando é calendário.
   */
  quoteDate: Date;
  refPrice: Prisma.Decimal;
  /** Limiar de defasagem DESTA praça — cada uma tem a sua cadência. */
  maxDiasSemBoletim: number;
  /** É a praça da própria empresa? */
  ehMinha: boolean;
}

export interface HistoricoDeProduto {
  produto: { id: string; name: string; serie: CeasaSerie };
  central: { code: string; name: string; city: string; uf: string; maxDiasSemBoletim: number };
  unit: string;
  periodo: PeriodoDeHistorico;
  /** O boletim mais recente desta praça para este produto. */
  atual: PontoDoHistorico;
  /** Do mais antigo ao mais recente, dentro da janela escolhida. */
  pontos: PontoDoHistorico[];
  resumo: {
    minimo: Prisma.Decimal;
    maximo: Prisma.Decimal;
    media: Prisma.Decimal;
    /** Do primeiro ao último ponto da janela. `null` com menos de dois pontos. */
    variacaoNoPeriodo: number | null;
  } | null;
  /** Vazia quando ainda não há meses suficientes — ver o limiar acima. */
  mediaPorMes: MediaDoMes[];
  /** Quantos meses distintos existem no histórico de 12 meses. */
  mesesComDado: number;
  comparativo: PracaComparada[];
  meuProduto: { id: string; name: string } | null;
}

export const CotacoesHistoricoService = {
  /**
   * Tudo que a tela de um produto mostra. `null` quando o produto não é cotado
   * na praça desta empresa — que é o que transforma um id inventado na URL em
   * 404, em vez de numa tela vazia com cara de defeito.
   */
  async getHistorico(
    tenantId: string,
    input: { ceasaProductId: string; unit: string; periodo: PeriodoDeHistorico },
  ): Promise<HistoricoDeProduto | null> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        ceasaCentral: {
          select: {
            code: true,
            name: true,
            city: true,
            uf: true,
            maxDiasSemBoletim: true,
            sourceKey: true,
          },
        },
      },
    });
    const bruta = tenant?.ceasaCentral ?? null;
    if (!bruta) return null;
    const { sourceKey, ...central } = bruta;

    const produto = await prisma.ceasaProduct.findUnique({
      where: { id: input.ceasaProductId },
      select: { id: true, name: true, serie: true },
    });
    // O produto tem de ser da MESMA taxonomia que a praça publica. Sem esta
    // conferência, o id de um produto da série nacional abriria uma tela com o
    // nome genérico e o histórico da praça vazio, sem nada explicando por quê.
    if (!produto || produto.serie !== serieDaFonte(sourceKey)) return null;

    const hoje = civilParts(new Date());
    const corte = (dias: number) =>
      new Date(Date.UTC(hoje.year, hoje.month - 1, hoje.day - dias));

    const [pontos, porMes, comparativo, vinculo] = await Promise.all([
      pontosDoPeriodo(central.code, input, corte(input.periodo)),
      mediasMensais(central.code, input, corte(365)),
      pracasComparaveis(input, central.code),
      prisma.tenantCeasaLink.findFirst({
        where: { tenantId, ceasaProductId: produto.id },
        select: { product: { select: { id: true, name: true, deletedAt: true, active: true } } },
      }),
    ]);

    /*
      O "atual" é o boletim mais recente DA PRAÇA para este produto, e ele é
      procurado fora da janela de propósito.

      Se ele viesse da janela, um produto fora de safra — que sumiu do boletim há
      dois meses — abriria a tela em branco no filtro de 30 dias, como se o
      módulo tivesse falhado. Com esta consulta a tela mostra o último preço
      conhecido e a data dele, e o gráfico vazio passa a ter explicação.
    */
    const atual = await ultimoBoletim(central.code, input);
    if (!atual) return null;

    const mesesComDado = porMes.length;

    return {
      produto,
      central,
      unit: input.unit,
      periodo: input.periodo,
      atual,
      pontos,
      resumo: resumir(pontos),
      mediaPorMes: mesesComDado >= MESES_MINIMOS_PARA_MEDIA_MENSAL ? porMes : [],
      mesesComDado,
      comparativo,
      // Produto excluído ou desativado não é "meu produto" na tela — o vínculo
      // sobrevive ao soft delete, e mostrá-lo ofereceria estoque que não existe.
      meuProduto:
        vinculo?.product && !vinculo.product.deletedAt && vinculo.product.active
          ? { id: vinculo.product.id, name: vinculo.product.name }
          : null,
    };
  },
};

type Alvo = { ceasaProductId: string; unit: string };

async function pontosDoPeriodo(
  centralCode: string,
  alvo: Alvo,
  desde: Date,
): Promise<PontoDoHistorico[]> {
  const rows = await prisma.ceasaQuote.findMany({
    where: {
      centralCode,
      ceasaProductId: alvo.ceasaProductId,
      unit: alvo.unit,
      quoteDate: { gte: desde },
    },
    orderBy: { quoteDate: "asc" },
    select: { quoteDate: true, refPrice: true, minPrice: true, maxPrice: true },
  });
  return rows;
}

async function ultimoBoletim(centralCode: string, alvo: Alvo): Promise<PontoDoHistorico | null> {
  return prisma.ceasaQuote.findFirst({
    where: { centralCode, ceasaProductId: alvo.ceasaProductId, unit: alvo.unit },
    orderBy: { quoteDate: "desc" },
    select: { quoteDate: true, refPrice: true, minPrice: true, maxPrice: true },
  });
}

/**
 * Média do produto em cada mês do calendário, nos últimos 12 meses.
 *
 * `EXTRACT(MONTH ...)` sobre uma coluna `DATE` não passa por fuso nenhum — é
 * aritmética de calendário sobre o dia que a fonte publicou, que é exatamente o
 * que `@db.Date` existe para preservar.
 */
async function mediasMensais(
  centralCode: string,
  alvo: Alvo,
  desde: Date,
): Promise<MediaDoMes[]> {
  const rows = await prisma.$queryRaw<
    { mes: number; media: Prisma.Decimal | string; amostras: number }[]
  >`
    SELECT EXTRACT(MONTH FROM "quoteDate")::int AS mes,
           AVG("refPrice")                      AS media,
           COUNT(*)::int                        AS amostras
    FROM ceasa_quotes
    WHERE "centralCode" = ${centralCode}
      AND "ceasaProductId" = ${alvo.ceasaProductId}
      AND unit = ${alvo.unit}
      AND "quoteDate" >= ${desde}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((r) => ({
    mes: r.mes,
    media: r.media as Prisma.Decimal,
    amostras: r.amostras,
  }));
}

/**
 * O preço mais recente deste produto em cada praça que o cota.
 *
 * `DISTINCT ON` faz o "último por grupo" em uma passada, usando a ordenação do
 * índice `(ceasaProductId, centralCode, quoteDate)`. Medido com 205 mil
 * cotações: 3,9 ms e 151 páginas lidas. Sem aquele índice era `Seq Scan` da
 * tabela inteira, 11,9 ms e 3.845 páginas — e crescendo com o histórico.
 *
 * A UNIDADE é filtro, e não podia não ser: comparar o quilo de uma praça com a
 * caixa de outra na mesma lista produziria uma "diferença de 1.900%" que é só
 * embalagem. Praça inativa fica de fora — é catálogo desligado, não oferta.
 */
async function pracasComparaveis(alvo: Alvo, minhaCentral: string): Promise<PracaComparada[]> {
  const rows = await prisma.$queryRaw<
    {
      centralCode: string;
      name: string;
      city: string;
      uf: string;
      quoteDate: Date;
      refPrice: Prisma.Decimal | string;
      maxDiasSemBoletim: number;
    }[]
  >`
    SELECT DISTINCT ON (q."centralCode")
           q."centralCode"       AS "centralCode",
           c.name                AS name,
           c.city                AS city,
           c.uf                  AS uf,
           q."quoteDate"         AS "quoteDate",
           q."refPrice"          AS "refPrice",
           c."maxDiasSemBoletim" AS "maxDiasSemBoletim"
    FROM ceasa_quotes q
    JOIN ceasa_centrals c ON c.code = q."centralCode" AND c.active = true
    WHERE q."ceasaProductId" = ${alvo.ceasaProductId}
      AND q.unit = ${alvo.unit}
    ORDER BY q."centralCode", q."quoteDate" DESC
  `;

  return rows
    .map((r) => ({
      centralCode: r.centralCode,
      name: r.name,
      city: r.city,
      uf: r.uf,
      quoteDate: r.quoteDate,
      refPrice: r.refPrice as Prisma.Decimal,
      maxDiasSemBoletim: r.maxDiasSemBoletim,
      ehMinha: r.centralCode === minhaCentral,
    }))
    .sort((a, b) => a.refPrice.comparedTo(b.refPrice));
}

/** Mínimo, máximo, média e a variação de ponta a ponta da janela. */
function resumir(pontos: PontoDoHistorico[]): HistoricoDeProduto["resumo"] {
  if (pontos.length === 0) return null;

  let minimo = pontos[0].refPrice;
  let maximo = pontos[0].refPrice;
  let soma = pontos[0].refPrice;
  for (const p of pontos.slice(1)) {
    if (p.refPrice.lessThan(minimo)) minimo = p.refPrice;
    if (p.refPrice.greaterThan(maximo)) maximo = p.refPrice;
    soma = soma.plus(p.refPrice);
  }

  return {
    minimo,
    maximo,
    media: soma.dividedBy(pontos.length),
    // Com um ponto só não há "de quanto para quanto": a variação seria 0% e
    // pareceria estabilidade medida.
    variacaoNoPeriodo:
      pontos.length >= 2
        ? variacaoPercentual(pontos.at(-1)!.refPrice, pontos[0].refPrice)
        : null,
  };
}
