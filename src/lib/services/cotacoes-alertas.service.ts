import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { serieDaFonte } from "@/lib/cotacoes/serie";
import { frescorDoBoletim } from "@/lib/cotacoes/frescor";
import { avaliarAlerta, type MotivoDoAlerta } from "@/lib/cotacoes/alerta";
import { variacaoPercentual } from "@/lib/cotacoes/variacao";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Alertas de flutuação e os "produtos de interesse" da empresa.
 *
 * Duas leituras diferentes saem do mesmo lugar de propósito, porque são a mesma
 * consulta: os últimos dois boletins da praça, restritos aos itens que a empresa
 * acompanha. Uma vira o cartão do Início (preço de agora), a outra vira o aviso
 * (o que mexeu). Fazer duas seria pagar o mesmo percurso de índice duas vezes.
 *
 * `prisma` cru com `tenantId` explícito, como no resto do módulo: a consulta
 * mistura tabelas globais (praça, produto do boletim, cotação) com tabelas da
 * empresa (vínculo, alerta), e a extensão multi-tenant só cobriria metade.
 */

/** O que a empresa acompanha: o que ela vende, e o que ela mandou vigiar. */
export interface ItemDeInteresse {
  ceasaProductId: string;
  nome: string;
  unit: string;
  refPrice: Prisma.Decimal | null;
  anterior: Prisma.Decimal | null;
  variacao: number | null;
  /** Nome do produto do cliente, quando este item do boletim está vinculado. */
  meuProdutoNome: string | null;
  /** Configuração do alerta, quando existe. */
  alerta: { variacaoMinima: Prisma.Decimal; precoTeto: Prisma.Decimal | null; precoPiso: Prisma.Decimal | null } | null;
}

export interface InteressesDaEmpresa {
  central: { code: string; name: string; city: string; uf: string; maxDiasSemBoletim: number };
  quoteDate: Date;
  itens: ItemDeInteresse[];
}

export interface DisparoDeAlerta extends ItemDeInteresse {
  motivos: MotivoDoAlerta[];
}

export interface AlertaSalvo {
  id: string;
  ceasaProductId: string;
  nome: string;
  unit: string;
  variacaoMinima: Prisma.Decimal;
  precoTeto: Prisma.Decimal | null;
  precoPiso: Prisma.Decimal | null;
}

export const CotacoesAlertasService = {
  /**
   * O que a empresa acompanha, com o preço do último boletim e a variação.
   *
   * `null` quando não há praça escolhida ou quando ela nunca trouxe boletim —
   * os dois casos em que não há número nenhum a mostrar.
   */
  async getInteresses(tenantId: string): Promise<InteressesDaEmpresa | null> {
    const contexto = await contextoDaEmpresa(tenantId);
    if (!contexto) return null;
    const { central, serie } = contexto;

    const [vinculos, alertas] = await Promise.all([
      prisma.tenantCeasaLink.findMany({
        where: { tenantId, product: { deletedAt: null, active: true } },
        select: { ceasaProductId: true, product: { select: { name: true } } },
      }),
      prisma.tenantCeasaAlerta.findMany({
        where: { tenantId },
        select: {
          ceasaProductId: true,
          unit: true,
          variacaoMinima: true,
          precoTeto: true,
          precoPiso: true,
        },
      }),
    ]);

    const idsDeInteresse = [
      ...new Set([...vinculos.map((v) => v.ceasaProductId), ...alertas.map((a) => a.ceasaProductId)]),
    ];
    if (idsDeInteresse.length === 0) return null;

    const cotacoes = await ultimosDoisBoletins(central.code, serie, idsDeInteresse);
    if (!cotacoes) return null;

    const nomeDoMeuProduto = new Map(vinculos.map((v) => [v.ceasaProductId, v.product.name]));
    const porChave = new Map(alertas.map((a) => [`${a.ceasaProductId}|${a.unit}`, a]));

    const itens: ItemDeInteresse[] = cotacoes.linhas.map((l) => {
      const alerta = porChave.get(`${l.ceasaProductId}|${l.unit}`) ?? null;
      return {
        ceasaProductId: l.ceasaProductId,
        nome: l.nome,
        unit: l.unit,
        refPrice: l.refPrice,
        anterior: l.anterior,
        variacao: variacaoPercentual(l.refPrice, l.anterior),
        meuProdutoNome: nomeDoMeuProduto.get(l.ceasaProductId) ?? null,
        alerta: alerta
          ? {
              variacaoMinima: alerta.variacaoMinima,
              precoTeto: alerta.precoTeto,
              precoPiso: alerta.precoPiso,
            }
          : null,
      };
    });

    /*
      Ordena por MOVIMENTO, não por nome.

      O cartão do Início mostra poucas linhas, e a pergunta que ele responde é
      "mudou alguma coisa no que eu compro?". Em ordem alfabética, a abobrinha
      que não mexeu empurra para fora da lista o tomate que subiu 20%.
    */
    itens.sort((a, b) => Math.abs(b.variacao ?? 0) - Math.abs(a.variacao ?? 0));

    return { central, quoteDate: cotacoes.quoteDate, itens };
  },

  /**
   * Os alertas que dispararam no boletim mais recente.
   *
   * **Só sobre boletim que a praça ainda considera atual.** Esta é a regra que
   * impede o alerta de virar ruído, e ela merece o parágrafo:
   *
   * Uma praça que parou de publicar (as 57 do catálogo que dependem de envio
   * manual são o caso comum) mantém para sempre o mesmo "último boletim". Sem
   * corte, o mesmo "batata subiu 18%" entraria no resumo diário todo dia, para
   * sempre — e um alarme que toca todo dia é desligado pelo usuário em uma
   * semana, levando junto o aviso da alta de verdade.
   *
   * O corte é o limiar DA PRAÇA (`maxDiasSemBoletim`, medido por unidade), e não
   * um número fixo: quem publica 2 a 3 vezes por semana não está defasado no
   * terceiro dia.
   *
   * **Por que não `importedAt`.** Seria o sinal mais direto de "chegou boletim
   * novo", e não serve: `importarCentral` recua até achar um dia com publicação,
   * então relê o MESMO boletim todo dia enquanto a praça não publica outro — e o
   * `ON CONFLICT` da gravação atualiza `importedAt`. O carimbo diz quando lemos,
   * não quando a praça publicou, e ficaria novo todo dia.
   */
  async disparosDoBoletim(
    tenantId: string,
    agora: Date = new Date(),
  ): Promise<{ quoteDate: Date; disparos: DisparoDeAlerta[] } | null> {
    const interesses = await this.getInteresses(tenantId);
    if (!interesses) return null;

    const frescor = frescorDoBoletim(
      interesses.quoteDate,
      agora,
      interesses.central.maxDiasSemBoletim,
    );
    if (frescor.nivel === "defasado") return null;

    const disparos = interesses.itens
      .filter((i) => i.alerta !== null)
      .map((i) => ({
        ...i,
        motivos: avaliarAlerta(i.alerta!, { refPrice: i.refPrice, anterior: i.anterior }).motivos,
      }))
      .filter((d) => d.motivos.length > 0);

    if (disparos.length === 0) return null;
    return { quoteDate: interesses.quoteDate, disparos };
  },

  /** Os alertas configurados, para a tela de gestão. */
  async listar(tenantId: string): Promise<AlertaSalvo[]> {
    const linhas = await prisma.tenantCeasaAlerta.findMany({
      where: { tenantId },
      orderBy: { ceasaProduct: { name: "asc" } },
      select: {
        id: true,
        ceasaProductId: true,
        unit: true,
        variacaoMinima: true,
        precoTeto: true,
        precoPiso: true,
        ceasaProduct: { select: { name: true } },
      },
    });
    return linhas.map((l) => ({
      id: l.id,
      ceasaProductId: l.ceasaProductId,
      nome: l.ceasaProduct.name,
      unit: l.unit,
      variacaoMinima: l.variacaoMinima,
      precoTeto: l.precoTeto,
      precoPiso: l.precoPiso,
    }));
  },

  /**
   * Cria ou reconfigura o alerta de um item do boletim.
   *
   * `upsert` pela chave natural: tocar duas vezes no botão reconfigura em vez de
   * empilhar dois alertas iguais, que renderiam o mesmo aviso duplicado sem o
   * usuário ter como saber por quê.
   */
  async salvar(
    input: {
      ceasaProductId: string;
      unit: string;
      variacaoMinima: number;
      precoTeto: number | null;
      precoPiso: number | null;
    },
    ctx: TenantCtx,
  ) {
    const contexto = await contextoDaEmpresa(ctx.tenantId);
    if (!contexto) {
      throw new BusinessRuleError("Escolha a sua central do CEASA antes de criar alertas.");
    }

    const produto = await prisma.ceasaProduct.findUnique({
      where: { id: input.ceasaProductId },
      select: { id: true, name: true, serie: true },
    });
    if (!produto) throw new NotFoundError("Produto do boletim não encontrado.");
    /*
      O produto tem de ser da MESMA taxonomia que a praça publica.

      Sem esta conferência dá para gravar um alerta sobre um produto genérico da
      série nacional para quem lê o boletim específico da praça: o alerta ficaria
      salvo, apareceria na tela de gestão e nunca dispararia, porque a consulta
      do boletim filtra por série. Um botão que não faz nada, sem explicação.
    */
    if (produto.serie !== contexto.serie) {
      throw new BusinessRuleError("Este produto não é cotado pela sua central.");
    }
    // ...e a praça tem de cotar ESTE item NESTA embalagem. Um alerta sobre uma
    // embalagem que a praça não publica também nunca dispararia.
    const cotado = await prisma.ceasaQuote.findFirst({
      where: {
        centralCode: contexto.central.code,
        ceasaProductId: produto.id,
        unit: input.unit,
      },
      select: { quoteDate: true },
    });
    if (!cotado) {
      throw new BusinessRuleError("A sua central não cota este produto nesta embalagem.");
    }

    if (
      input.precoTeto !== null &&
      input.precoPiso !== null &&
      input.precoPiso >= input.precoTeto
    ) {
      // Piso acima do teto dispararia os dois avisos em todo boletim.
      throw new BusinessRuleError("O piso precisa ser menor que o teto.");
    }

    const salvo = await prisma.tenantCeasaAlerta.upsert({
      where: {
        tenantId_ceasaProductId_unit: {
          tenantId: ctx.tenantId,
          ceasaProductId: produto.id,
          unit: input.unit,
        },
      },
      create: {
        tenantId: ctx.tenantId,
        ceasaProductId: produto.id,
        unit: input.unit,
        variacaoMinima: input.variacaoMinima,
        precoTeto: input.precoTeto,
        precoPiso: input.precoPiso,
      },
      update: {
        variacaoMinima: input.variacaoMinima,
        precoTeto: input.precoTeto,
        precoPiso: input.precoPiso,
      },
    });

    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "TenantCeasaAlerta",
      entityId: salvo.id,
      newData: {
        produto: produto.name,
        unidade: input.unit,
        variacaoMinima: input.variacaoMinima,
        teto: input.precoTeto,
        piso: input.precoPiso,
      },
      ip: ctx.ip,
    });
    return salvo;
  },

  async remover(input: { ceasaProductId: string; unit: string }, ctx: TenantCtx) {
    // `deleteMany` com o tenantId no filtro: é o que impede um id de outra
    // empresa de apagar alerta alheio.
    const r = await prisma.tenantCeasaAlerta.deleteMany({
      where: {
        tenantId: ctx.tenantId,
        ceasaProductId: input.ceasaProductId,
        unit: input.unit,
      },
    });
    if (r.count === 0) throw new BusinessRuleError("Este produto não tinha alerta.");
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "TenantCeasaAlerta",
      entityId: input.ceasaProductId,
      ip: ctx.ip,
    });
  },
};

/** A praça da empresa e a série que ela publica. `null` quando não há praça. */
async function contextoDaEmpresa(tenantId: string) {
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
  return { central, serie: serieDaFonte(sourceKey) };
}

/**
 * Os DOIS últimos boletins da praça, restritos aos itens acompanhados.
 *
 * Dois, e não oito como no minigráfico do cartão: aqui só se precisa do preço
 * de agora e do anterior, e cada data a mais é uma varredura a mais numa
 * consulta que roda em todo carregamento do Início.
 *
 * O recorte por SÉRIE se repete dentro do `WITH` pela mesma razão de
 * `ultimosBoletins`: numa praça coberta por duas fontes, as datas mais recentes
 * poderiam ser todas de uma taxonomia e os itens da outra viriam vazios.
 */
async function ultimosDoisBoletins(
  centralCode: string,
  serie: string,
  ceasaProductIds: string[],
): Promise<{
  quoteDate: Date;
  linhas: {
    ceasaProductId: string;
    nome: string;
    unit: string;
    refPrice: Prisma.Decimal;
    anterior: Prisma.Decimal | null;
  }[];
} | null> {
  const pontos = await prisma.$queryRaw<
    {
      ceasaProductId: string;
      nome: string;
      unit: string;
      quoteDate: Date;
      refPrice: Prisma.Decimal;
    }[]
  >`
    WITH datas AS (
      SELECT DISTINCT q."quoteDate"
      FROM ceasa_quotes q
      JOIN ceasa_products cp ON cp.id = q."ceasaProductId" AND cp.serie = ${serie}::"CeasaSerie"
      WHERE q."centralCode" = ${centralCode}
      ORDER BY 1 DESC
      LIMIT 2
    )
    SELECT q."ceasaProductId" AS "ceasaProductId",
           cp.name            AS nome,
           q.unit             AS unit,
           q."quoteDate"      AS "quoteDate",
           q."refPrice"       AS "refPrice"
    FROM ceasa_quotes q
    JOIN ceasa_products cp ON cp.id = q."ceasaProductId" AND cp.serie = ${serie}::"CeasaSerie"
    WHERE q."centralCode" = ${centralCode}
      AND q."quoteDate" IN (SELECT "quoteDate" FROM datas)
      AND q."ceasaProductId" IN (${Prisma.join(ceasaProductIds)})
    ORDER BY q."quoteDate" ASC
  `;

  if (pontos.length === 0) return null;
  const quoteDate = pontos.reduce(
    (max, p) => (p.quoteDate > max ? p.quoteDate : max),
    pontos[0].quoteDate,
  );

  // A chave é produto+EMBALAGEM: o mesmo item sai por quilo e por caixa, com
  // preços de ordem de grandeza diferente. Juntar os dois inventaria variação.
  const porChave = new Map<string, typeof pontos>();
  for (const p of pontos) {
    const chave = `${p.ceasaProductId}|${p.unit}`;
    porChave.set(chave, [...(porChave.get(chave) ?? []), p]);
  }

  const linhas = [];
  for (const serieDoItem of porChave.values()) {
    const atual = serieDoItem.find((p) => p.quoteDate.getTime() === quoteDate.getTime());
    // Item que não aparece no boletim mais recente não tem preço de agora:
    // mostrá-lo com o preço antigo no cartão do Início seria dar um número de
    // outro dia como se fosse o de hoje.
    if (!atual) continue;
    const anterior =
      serieDoItem.find((p) => p.quoteDate.getTime() < quoteDate.getTime())?.refPrice ?? null;
    linhas.push({
      ceasaProductId: atual.ceasaProductId,
      nome: atual.nome,
      unit: atual.unit,
      refPrice: atual.refPrice,
      anterior,
    });
  }

  if (linhas.length === 0) return null;
  return { quoteDate, linhas };
}
