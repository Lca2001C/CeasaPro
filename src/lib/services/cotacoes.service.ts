import { after } from "next/server";
import type { CeasaSerie, Prisma, SaleUnit } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { sugerirVinculos } from "@/lib/cotacoes/nome";
import {
  embalagemCasaComVenda,
  precoPorKg,
  sugerirUnidade,
} from "@/lib/cotacoes/embalagem";
import { variacaoPercentual } from "@/lib/cotacoes/variacao";
import { toNumber } from "@/lib/money";
import { serieDaFonte } from "@/lib/cotacoes/serie";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Leitura das cotações e gestão dos vínculos.
 *
 * As tabelas de central, produto do boletim e cotação são GLOBAIS — o preço da
 * central é o mesmo para todo mundo que compra ali — então são lidas pelo
 * `prisma` cru, como `rate_limits`. O escopo de empresa entra por dois caminhos
 * explícitos: a central que a empresa escolheu (`tenant.ceasaCentralCode`) e os
 * vínculos dela (`tenant_ceasa_links`, que passa pela extensão multi-tenant).
 */

export interface LinhaDeCotacao {
  ceasaProductId: string;
  ceasaProductName: string;
  unit: string;
  refPrice: Prisma.Decimal | null;
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  /** Produto do cliente vinculado a esta cotação, se houver. */
  meuProdutoId: string | null;
  meuProdutoNome: string | null;
  /**
   * A embalagem que o cliente escolheu no vínculo. `null` = "qualquer".
   *
   * Só faz sentido quando `meuProdutoId` existe. Serve ao cartão para dizer
   * "sua embalagem é CX 20 KG" na linha do quilo do mesmo produto.
   */
  minhaEmbalagem: string | null;
  /**
   * Que tipo de vínculo esta linha tem — e são TRÊS estados, não dois.
   *
   *  - `"exato"`: o cliente vende este item NESTA embalagem (ou não escolheu
   *    embalagem, e aí toda linha do item é dele).
   *  - `"outra_embalagem"`: é o item que ele vende, em embalagem diferente da
   *    que ele escolheu. Não pode carregar a estrela verde no mesmo peso — mas
   *    também não pode desaparecer: é o que responde "meu tomate está a R$ 85 a
   *    caixa e a R$ 4,20 o quilo".
   *  - `null`: item que ele não vende.
   */
  vinculo: "exato" | "outra_embalagem" | null;
  /** Saldo do produto vinculado. Null quando não há vínculo. */
  meuSaldo: Prisma.Decimal | null;
  /**
   * O boletim ANTERIOR em que este produto apareceu, com a data dele.
   *
   * A data vai junto, e não é detalhe de layout: o cartão NÃO pode dizer
   * "ontem". Medido em 8 dias úteis seguidos contra a fonte real, Juiz de Fora,
   * Barbacena, Caratinga e Poços de Caldas publicam 2 a 3 vezes por semana — e
   * um produto fora de safra some do boletim por semanas mesmo onde a praça
   * publica todo dia. Chamar de "ontem" um preço de seis dias atrás é errar na
   * direção que faz o comerciante repassar preço velho achando que é de ontem.
   *
   * `null` quando o produto não aparece em nenhum dos boletins recentes lidos:
   * é o caso de estreia no boletim, e aí não há variação a mostrar.
   */
  anterior: { quoteDate: Date; refPrice: Prisma.Decimal } | null;
  /** Variação percentual do boletim anterior para este. `null` sem anterior. */
  variacao: number | null;
  /**
   * Preços dos últimos boletins, do mais antigo ao mais recente, para o
   * minigráfico do cartão. `number` e não `Decimal` porque isto vira altura de
   * pixel, não conta de dinheiro.
   */
  serie: number[];
}

export interface PainelDeCotacoes {
  central: {
    code: string;
    name: string;
    city: string;
    uf: string;
    maxDiasSemBoletim: number;
    /**
     * Esta central tem busca automática de boletim?
     *
     * Das 65 centrais do catálogo, 8 têm raspador; as outras dependem de alguém
     * colar o boletim. A tela PRECISA dizer qual é o caso: prometer "assim que o
     * primeiro boletim chegar" para uma central que ninguém busca é prometer o
     * que não vem.
     */
    automatica: boolean;
  } | null;
  /** Data do BOLETIM mostrado. Null quando ainda não há cotação nenhuma. */
  quoteDate: Date | null;
  linhas: LinhaDeCotacao[];
  /** Produtos do cliente que ainda não têm vínculo — a lista de tarefas do módulo. */
  semVinculo: { id: string; name: string }[];
  /**
   * Quantos desses produtos têm um item de nome IDÊNTICO no boletim de hoje.
   *
   * Transforma "você tem 12 produtos sem cotação" — um número que não diz se o
   * trabalho é fácil ou impossível — em "9 deles já têm o nome exato no boletim".
   * É o que faz a pessoa abrir a tela de vínculo, onde esses 9 vêm pré-marcados
   * e saem em um clique.
   *
   * Cobre de graça o caso "produto novo entrou no boletim": no dia em que a praça
   * passa a publicar um item que casa com algo que o cliente vende, este número
   * sobe sozinho. Calculado em memória sobre o boletim já carregado — nenhuma
   * consulta a mais.
   */
  semVinculoComNomeIdentico: number;
  /**
   * A empresa tem ALGUM vínculo? Contado nos vínculos, não nas linhas.
   *
   * A diferença não é estilo. Derivar isto de `linhas.some(l => l.meuProdutoId)`
   * — como a tela fazia — significa que num dia em que a embalagem vinculada não
   * sai no boletim, o módulo conclui "esta empresa nunca vinculou nada": abre no
   * filtro "Todos" e a seção verde desaparece inteira, para quem vinculou tudo.
   */
  temVinculo: boolean;
  /**
   * Vínculos que NÃO encontraram preço no boletim de hoje.
   *
   * Existe para fechar o único jeito de esta tela piorar com a embalagem no
   * vínculo: quem vinculou "Tomate → CX 20 KG" e abre num dia em que a praça só
   * publicou o quilo (ou mudou a grafia para `CX 18 KG`) não tem o produto em
   * `semVinculo` — ele TEM vínculo — nem em `linhas` — nada casou. Sem esta
   * lista, o produto simplesmente sai da tela, sem uma palavra. É exatamente a
   * classe de silêncio que o módulo foi desenhado para não cometer.
   */
  vinculosSemCotacao: {
    produtoId: string;
    produtoNome: string;
    ceasaProductName: string;
    unit: string | null;
  }[];
}

/**
 * O boletim de um produto do cliente, pronto para uma tela de operação.
 *
 * Tudo em `number` e `Date` porque isto atravessa a fronteira para Client
 * Components (o formulário de compra, o PDV), e `Decimal` não é serializável.
 * É a borda de que `money.ts` fala — nenhuma conta é feita a partir daqui.
 */
export interface ReferenciaDoBoletim {
  refPrice: number;
  /** A embalagem em que este preço foi publicado. Vai SEMPRE junto do preço. */
  unit: string;
  quoteDate: Date;
  ceasaProductName: string;
  /** `null` quando o boletim não declara o peso da embalagem — ver `pesoEmKg`. */
  precoPorKg: number | null;
}

/**
 * A última compra contra o boletim.
 *
 * `elegiveis` são os produtos vinculados que já foram comprados alguma vez;
 * `comparados` são aqueles em que a embalagem do boletim fala da mesma unidade
 * em que o produto é vendido. A diferença entre os dois números é o que a tela
 * tem obrigação de mostrar.
 */
export interface ComparacaoComOBoletim {
  comparados: number;
  elegiveis: number;
  acima: {
    produtoId: string;
    produtoNome: string;
    pago: number;
    refPrice: number;
    unit: string;
    /** Percentual acima do boletim. Sempre positivo — abaixo não entra. */
    diferenca: number;
  }[];
}

export const CotacoesService = {
  /**
   * Centrais que a empresa pode escolher.
   *
   * Devolve `automatica` porque a tela de escolha PRECISA separar as duas
   * situações: das 65 centrais do catálogo, 8 têm busca automática de boletim e
   * 57 dependem de envio manual. Oferecer todas na mesma lista, sem distinção,
   * faria alguém de Recife escolher a sua e ficar esperando um preço que ninguém
   * vai buscar — descobrindo isso só depois de contratar o módulo.
   */
  async listarCentrais() {
    const centrais = await prisma.ceasaCentral.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        code: true,
        name: true,
        city: true,
        uf: true,
        maxDiasSemBoletim: true,
        sourceKey: true,
      },
    });
    return centrais.map(({ sourceKey, ...c }) => ({
      ...c,
      automatica: sourceKey !== "manual",
    }));
  },

  /**
   * Tudo que a tela de cotações precisa.
   *
   * Uma consulta para as cotações (com o vínculo e o saldo por LEFT JOIN) e uma
   * para os produtos sem vínculo. O filtro por texto e a separação entre "meus"
   * e "todos" acontecem em memória, como em `estoque/page.tsx`: o volume é o de
   * um boletim (algumas centenas de linhas), e ir ao banco a cada tecla custaria
   * mais que filtrar aqui.
   */
  async getPainel(tenantId: string): Promise<PainelDeCotacoes> {
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
    if (!bruta) {
      return {
        central: null,
        quoteDate: null,
        linhas: [],
        semVinculo: [],
        semVinculoComNomeIdentico: 0,
        temVinculo: false,
        vinculosSemCotacao: [],
      };
    }
    const { sourceKey, ...dadosDaCentral } = bruta;
    const central = { ...dadosDaCentral, automatica: sourceKey !== "manual" };
    // A série que ESTA central usa. Ver o comentário do `aggregate` abaixo.
    const serie = serieDaFonte(sourceKey);

    /*
      A data do boletim MAIS RECENTE desta central, DENTRO DA SÉRIE que ela usa.

      Sem o recorte por dia, a tela misturaria dias diferentes na mesma lista: o
      preço de um produto seria de ontem e o do vizinho de uma semana atrás, sem
      nada indicando isso.

      Sem o recorte por SÉRIE, acontece coisa pior numa central coberta por duas
      fontes: as duas taxonomias competem pelo `MAX`, e a tela troca de vocabulário
      sozinha conforme qual publicou por último — o cliente que vinculou seus
      produtos aos nomes específicos do boletim abriria o app e encontraria os
      nomes genéricos da série nacional no lugar, sem explicação.
    */
    const ultima = await prisma.ceasaQuote.aggregate({
      where: { centralCode: central.code, product: { serie } },
      _max: { quoteDate: true },
    });
    const quoteDate = ultima._max.quoteDate ?? null;
    if (!quoteDate) {
      const [sem, vinculos] = await Promise.all([
        semVinculo(tenantId),
        vinculosDaEmpresa(tenantId),
      ]);
      // `vinculosSemCotacao` fica vazio de propósito: sem boletim NENHUM, listar
      // cada vínculo como "sem cotação" repetiria em N linhas o que o cabeçalho
      // da tela já diz numa ("ainda não chegou boletim desta praça").
      return {
        central,
        quoteDate: null,
        linhas: [],
        semVinculo: sem,
        // Sem boletim não há com o que casar nome.
        semVinculoComNomeIdentico: 0,
        temVinculo: vinculos.length > 0,
        vinculosSemCotacao: [],
      };
    }

    const rows = await prisma.$queryRaw<
      {
        ceasaProductId: string;
        ceasaProductName: string;
        unit: string;
        refPrice: Prisma.Decimal | string | null;
        minPrice: Prisma.Decimal | string | null;
        maxPrice: Prisma.Decimal | string | null;
        meuProdutoId: string | null;
        meuProdutoNome: string | null;
        minhaEmbalagem: string | null;
        meuSaldo: Prisma.Decimal | string | null;
      }[]
    >`
      SELECT cp.id            AS "ceasaProductId",
             cp.name          AS "ceasaProductName",
             q.unit           AS unit,
             q."refPrice"     AS "refPrice",
             q."minPrice"     AS "minPrice",
             q."maxPrice"     AS "maxPrice",
             v."productId"    AS "meuProdutoId",
             v."produtoNome"  AS "meuProdutoNome",
             v.unit           AS "minhaEmbalagem",
             saldo.quantity   AS "meuSaldo"
      FROM ceasa_quotes q
      JOIN ceasa_products cp ON cp.id = q."ceasaProductId" AND cp.serie = ${serie}::"CeasaSerie"
      /*
        UM vínculo por cotação, escolhido de propósito — e não um LEFT JOIN
        comum.

        A chave única do vínculo é (tenantId, productId), NÃO o inverso: o schema
        permite, e documenta, que "Tomate caixa" e "Tomate kg" apontem para o
        mesmo item do boletim. Com LEFT JOIN comum esses dois vínculos
        MULTIPLICAM a linha da cotação — dois cartões idênticos na tela e chaves
        React duplicadas na grade. O defeito existia antes desta mudança e não
        aparecia em teste porque o e2e vincula um produto só.

        O ORDER BY abaixo é o que faz a escolha ser a certa em vez de arbitrária:
        vínculo na embalagem EXATA ganha; depois o vínculo "qualquer embalagem";
        empate resolve pelo mais antigo, para a tela não trocar de resposta entre
        duas aberturas.

        O filtro de produto ativo mora AQUI dentro, não num join de fora: se um
        cliente tem dois produtos no mesmo item do boletim e um está inativo,
        filtrar depois do LIMIT 1 poderia devolver o inativo e esconder o ativo.
      */
      LEFT JOIN LATERAL (
        SELECT l."productId", l.unit, p.name AS "produtoNome"
        FROM tenant_ceasa_links l
        JOIN products p
          ON p.id = l."productId" AND p."deletedAt" IS NULL AND p.active = true
        WHERE l."tenantId" = ${tenantId} AND l."ceasaProductId" = cp.id
        ORDER BY (l.unit IS NOT NULL AND l.unit = q.unit) DESC,
                 (l.unit IS NULL) DESC,
                 l."createdAt" ASC
        LIMIT 1
      ) v ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(CASE WHEN m.type IN ('ENTRADA','AJUSTE') THEN m.quantity ELSE -m.quantity END), 0) AS quantity
        FROM stock_movements m
        WHERE m."productId" = v."productId" AND m."tenantId" = ${tenantId}
      ) saldo ON v."productId" IS NOT NULL
      WHERE q."centralCode" = ${central.code} AND q."quoteDate" = ${quoteDate}
      ORDER BY cp.name ASC, q.unit ASC
    `;

    const [recentes, sem, vinculos] = await Promise.all([
      ultimosBoletins(central.code, serie),
      semVinculo(tenantId),
      vinculosDaEmpresa(tenantId),
    ]);

    return {
      central,
      quoteDate,
      semVinculo: sem,
      semVinculoComNomeIdentico: comNomeIdentico(sem, rows),
      temVinculo: vinculos.length > 0,
      vinculosSemCotacao: vinculosSemCotacao(vinculos, rows),
      linhas: rows.map((r) => {
        // A série deste produto NESTA embalagem. A unidade entra na chave
        // porque o boletim cota a mesma fruta em caixa e em quilo com preços de
        // ordem de grandeza diferente: juntar as duas no mesmo minigráfico
        // desenharia um dente de serra que não existe no mercado.
        const doProduto = recentes.get(chaveDaSerie(r.ceasaProductId, r.unit)) ?? [];
        const anteriores = doProduto.filter((p) => p.quoteDate < quoteDate.getTime());
        const anterior = anteriores.at(-1) ?? null;
        const refPrice = dec(r.refPrice);
        // Vínculo sem embalagem escolhida vale para toda linha do item, então
        // conta como exato: é o comportamento de antes da coluna existir, e é o
        // que todo vínculo já gravado herda.
        const exato = r.minhaEmbalagem === null || r.minhaEmbalagem === r.unit;

        return {
          ceasaProductId: r.ceasaProductId,
          ceasaProductName: r.ceasaProductName,
          unit: r.unit,
          refPrice,
          minPrice: dec(r.minPrice),
          maxPrice: dec(r.maxPrice),
          meuProdutoId: r.meuProdutoId,
          meuProdutoNome: r.meuProdutoNome,
          minhaEmbalagem: r.minhaEmbalagem,
          vinculo: r.meuProdutoId ? (exato ? "exato" : "outra_embalagem") : null,
          meuSaldo: r.meuProdutoId ? (dec(r.meuSaldo) ?? null) : null,
          anterior: anterior
            ? { quoteDate: new Date(anterior.quoteDate), refPrice: anterior.refPrice }
            : null,
          variacao: variacaoPercentual(refPrice, anterior?.refPrice ?? null),
          serie: doProduto.map((p) => toNumber(p.refPrice)),
        };
      }),
    };
  },

  /**
   * Tela de vínculo: os produtos do cliente, o vínculo atual de cada um e as
   * sugestões ordenadas.
   *
   * As sugestões NUNCA são aplicadas sozinhas — ver `sugerirVinculos`.
   */
  async getTelaDeVinculo(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        ceasaCentralCode: true,
        ceasaCentral: { select: { code: true, name: true, sourceKey: true } },
      },
    });
    const central = tenant?.ceasaCentralCode ?? null;
    // Só produtos da MESMA taxonomia da central: oferecer o genérico nacional a
    // quem lê o boletim específico da praça produziria vínculo que nunca casa.
    const serie = serieDaFonte(tenant?.ceasaCentral?.sourceKey ?? "manual");

    const [meus, links, doBoletim] = await Promise.all([
      prisma.product.findMany({
        where: { tenantId, deletedAt: null, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, saleUnit: true, qtyPerRecipient: true },
      }),
      prisma.tenantCeasaLink.findMany({
        where: { tenantId },
        select: {
          productId: true,
          unit: true,
          ceasaProduct: { select: { id: true, name: true } },
        },
      }),
      /*
        Só os produtos que a central DESTA empresa realmente cota, agora COM as
        embalagens em que ela os cota.

        Antes a consulta trazia o catálogo global, e isso não era só desperdício:
        um cliente da Grande BH podia vincular seu tomate a um item que existe
        apenas no boletim de Uberlândia. O vínculo ficava gravado, `getPainel`
        filtrava por central e nunca encontrava preço — o produto seguia
        aparecendo como "sem cotação" para sempre, sem nada explicando por quê.

        As embalagens vêm junto porque a tela precisa das duas informações na
        mesma decisão: QUAL item do boletim é o meu tomate, e em QUAL embalagem.
        Perguntar em dois passos separados obrigaria a segunda ida ao banco por
        produto escolhido.
      */
      central ? unidadesPorProdutoDoBoletim(central, serie) : Promise.resolve([]),
    ]);

    const porProduto = new Map(
      links.map((l) => [l.productId, { ...l.ceasaProduct, unit: l.unit }]),
    );

    return {
      doBoletim,
      /*
        A praça vai junto, e o `automatica` é o campo que importa.

        A tela precisa dizer POR QUE não há cotação para vincular, e a resposta
        depende disto: numa praça com raspador o boletim chega sozinho ("assim
        que o primeiro chegar"); nas 57 manuais do catálogo ele nunca chega sem
        alguém enviar. É o defeito 13 da auditoria de 07/09 — a explicação
        culpava a cadência da praça quando a causa era ausência de fonte —, que
        foi corrigido na grade e continuava valendo nesta tela.
      */
      central: tenant?.ceasaCentral
        ? {
            code: tenant.ceasaCentral.code,
            name: tenant.ceasaCentral.name,
            automatica: tenant.ceasaCentral.sourceKey !== "manual",
          }
        : null,
      produtos: meus.map((p) => ({
        id: p.id,
        name: p.name,
        saleUnit: p.saleUnit,
        vinculo: porProduto.get(p.id) ?? null,
        /*
          O ESCORE vai junto, e antes ele era descartado aqui.

          Não é para a tela decidir sozinha — `sugerirVinculos` documenta que o
          escore só ordena. É para a tela poder pré-MARCAR o caso em que não há
          dúvida (escore 1 = nome normalizado idêntico) e deixar o cliente
          confirmar a lista inteira num clique, em vez de repetir 40 vezes uma
          decisão que já está tomada. Nada é gravado sem esse clique.

          Que só existe um candidato com escore 1 é garantido pelo banco, não pela
          sorte: `@@unique([serie, slug])` em `ceasa_products`, com o slug sendo o
          nome normalizado.
        */
        sugestoes: porProduto.has(p.id)
          ? []
          : sugerirVinculos(p.name, doBoletim, (c) => c.name).map((s) => ({
              item: s.item,
              escore: s.escore,
              // A embalagem sugerida acompanha a sugestão do item: é a mesma
              // decisão, e resolvê-la aqui evita que a tela tenha de repetir a
              // heurística no cliente.
              unidadeSugerida: sugerirUnidade(p.saleUnit, s.item.unidades, p.qtyPerRecipient),
            })),
      })),
    };
  },

  /**
   * O boletim mais recente de cada produto VINCULADO, indexado pelo id do
   * produto do cliente.
   *
   * É a forma de que as telas de operação precisam — a Compra e o PDV pensam em
   * "este produto meu", não em "este item do boletim". Uma consulta só, porque a
   * Compra já carrega produtos e fornecedores e não pode virar três idas ao
   * banco por abertura.
   *
   * Devolve `{}` quando não há central ou não há vínculo, e é a resposta certa:
   * a tela simplesmente não mostra a linha de referência.
   */
  async precosDoBoletimPorProduto(tenantId: string): Promise<Record<string, ReferenciaDoBoletim>> {
    const contexto = await centralESerie(tenantId);
    if (!contexto) return {};

    const rows = await prisma.$queryRaw<
      {
        productId: string;
        unit: string;
        refPrice: Prisma.Decimal | string;
        quoteDate: Date;
        ceasaProductName: string;
      }[]
    >`
      SELECT l."productId",
             q.unit,
             q."refPrice",
             q."quoteDate",
             cp.name AS "ceasaProductName"
      FROM tenant_ceasa_links l
      JOIN ceasa_products cp
        ON cp.id = l."ceasaProductId" AND cp.serie = ${contexto.serie}::"CeasaSerie"
      /*
        O boletim mais recente DESTE item, na embalagem que o cliente escolheu.

        Vínculo sem embalagem ("qualquer") tem de escolher uma, e a escolha é o
        QUILO quando a praça o publica: é 80% do boletim, é a leitura que todo
        comerciante faz de cabeça, e é a única que se compara com qualquer
        embalagem. Cair na primeira em ordem alfabética entregaria "CX 30 DZ"
        para quem vende tomate a quilo.
      */
      JOIN LATERAL (
        SELECT q2.unit, q2."refPrice", q2."quoteDate"
        FROM ceasa_quotes q2
        WHERE q2."centralCode" = ${contexto.centralCode}
          AND q2."ceasaProductId" = cp.id
          AND (l.unit IS NULL OR q2.unit = l.unit)
        ORDER BY q2."quoteDate" DESC, (q2.unit = 'KG') DESC, q2.unit ASC
        LIMIT 1
      ) q ON true
      JOIN products p
        ON p.id = l."productId" AND p."deletedAt" IS NULL AND p.active = true
      WHERE l."tenantId" = ${tenantId}
    `;

    const mapa: Record<string, ReferenciaDoBoletim> = {};
    for (const r of rows) {
      const refPrice = toNumber(r.refPrice as Prisma.Decimal);
      if (refPrice <= 0) continue;
      const porKg = precoPorKg(r.refPrice as Prisma.Decimal, r.unit);
      mapa[r.productId] = {
        refPrice,
        unit: r.unit,
        quoteDate: r.quoteDate,
        ceasaProductName: r.ceasaProductName,
        // `number` e não `Decimal` porque isto atravessa a fronteira para um
        // Client Component, e `Decimal` não é serializável.
        precoPorKg: porKg ? toNumber(porKg) : null,
      };
    }
    return mapa;
  },

  /**
   * Em quantos produtos a última compra saiu acima do boletim.
   *
   * A honestidade desta conta está no DENOMINADOR, não no numerador. Ela só
   * compara quando as duas pontas falam da mesma unidade — o produto é vendido
   * por caixa e o boletim publicou em caixa, ou os dois em quilo. Produto cuja
   * embalagem não casa fica FORA, e a tela diz sobre quantos a conta foi feita:
   * "2 de 9 produtos comparados". Um indicador que esconde o próprio
   * denominador é o número inventado com outro nome.
   *
   * O `unitPrice` da compra é o preço NEGOCIADO, sem o rateio do frete. Usar
   * `unitCost` somaria o caminhão do comprador a um preço de praça que é anterior
   * a qualquer transporte, e todo produto de todo cliente apareceria "acima" —
   * um viés constante e invisível.
   */
  async comprasAcimaDoBoletim(tenantId: string): Promise<ComparacaoComOBoletim> {
    const contexto = await centralESerie(tenantId);
    if (!contexto) return { comparados: 0, elegiveis: 0, acima: [] };

    const rows = await prisma.$queryRaw<
      {
        produtoId: string;
        produtoNome: string;
        saleUnit: SaleUnit;
        unit: string;
        refPrice: Prisma.Decimal | string;
        pago: Prisma.Decimal | string;
      }[]
    >`
      SELECT p.id            AS "produtoId",
             p.name          AS "produtoNome",
             p."saleUnit"    AS "saleUnit",
             q.unit          AS unit,
             q."refPrice"    AS "refPrice",
             lp."unitPrice"  AS pago
      FROM tenant_ceasa_links l
      JOIN ceasa_products cp
        ON cp.id = l."ceasaProductId" AND cp.serie = ${contexto.serie}::"CeasaSerie"
      JOIN products p
        ON p.id = l."productId" AND p."deletedAt" IS NULL AND p.active = true
      JOIN LATERAL (
        SELECT q2.unit, q2."refPrice"
        FROM ceasa_quotes q2
        WHERE q2."centralCode" = ${contexto.centralCode}
          AND q2."ceasaProductId" = cp.id
          AND (l.unit IS NULL OR q2.unit = l.unit)
        ORDER BY q2."quoteDate" DESC, (q2.unit = 'KG') DESC, q2.unit ASC
        LIMIT 1
      ) q ON true
      JOIN LATERAL (
        SELECT pi."unitPrice"
        FROM purchase_items pi
        JOIN purchases pu ON pu.id = pi."purchaseId"
        WHERE pi."tenantId" = ${tenantId}
          AND pi."productId" = p.id
          AND pu."deletedAt" IS NULL
        ORDER BY pu."purchaseDate" DESC, pi."createdAt" DESC
        LIMIT 1
      ) lp ON true
      WHERE l."tenantId" = ${tenantId}
    `;

    const acima: ComparacaoComOBoletim["acima"] = [];
    let comparados = 0;
    for (const r of rows) {
      if (!embalagemCasaComVenda(r.unit, r.saleUnit)) continue;
      comparados += 1;
      const diferenca = variacaoPercentual(r.pago as Prisma.Decimal, r.refPrice as Prisma.Decimal);
      if (diferenca === null || diferenca <= 0) continue;
      acima.push({
        produtoId: r.produtoId,
        produtoNome: r.produtoNome,
        pago: toNumber(r.pago as Prisma.Decimal),
        refPrice: toNumber(r.refPrice as Prisma.Decimal),
        unit: r.unit,
        diferenca,
      });
    }
    acima.sort((a, b) => b.diferenca - a.diferenca);
    return { comparados, elegiveis: rows.length, acima };
  },

  async escolherCentral(input: { centralCode: string | null }, ctx: TenantCtx) {
    if (input.centralCode) {
      const existe = await prisma.ceasaCentral.findFirst({
        where: { code: input.centralCode, active: true },
        select: { code: true },
      });
      if (!existe) throw new NotFoundError("Central não encontrada.");
    }
    const anterior = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { ceasaCentralCode: true },
    });
    const trocou = (anterior?.ceasaCentralCode ?? null) !== input.centralCode;

    /*
      Trocar de praça devolve os vínculos a "qualquer embalagem".

      `CeasaProduct` é catálogo GLOBAL justamente para o vínculo sobreviver à
      troca de central quando o nome do item coincide — está escrito no schema. A
      embalagem no vínculo ameaça essa garantia: a praça nova cota o mesmo item
      como `CX 18 KG` em vez de `CX 20 KG`, nada casa, e o vínculo sobrevive como
      carcaça — o produto sai da tela sem uma palavra.

      Zerar a embalagem preserva a propriedade documentada: o vínculo continua
      valendo, agora para todas as embalagens da praça nova, e o cliente reduz de
      novo quando quiser. É a mesma transação do `update` da central, com o
      `audit` dentro, porque são duas tabelas.
    */
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: { ceasaCentralCode: input.centralCode },
      });
      const embalagensZeradas = trocou
        ? (
            await tx.tenantCeasaLink.updateMany({
              where: { tenantId: ctx.tenantId, unit: { not: null } },
              data: { unit: null },
            })
          ).count
        : 0;
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "Tenant",
          entityId: ctx.tenantId,
          newData: { ceasaCentralCode: input.centralCode, embalagensZeradas },
          ip: ctx.ip,
        },
        tx,
      );
    });

    /*
      Partida a frio.

      Sem isto, quem acabou de contratar o módulo e escolheu a central abria uma
      tela vazia e ficava assim até o cron da madrugada seguinte — pagando por um
      recurso que, na primeira impressão, não faz nada. A cotação é o produto;
      entregá-la só no dia seguinte é entregar mal.

      Roda DEPOIS da resposta (`after`), pelo mesmo motivo do cadastro público: a
      importação fala com um site externo lento, e ninguém deve esperar por isso
      com o botão girando. Se falhar, o cron tenta de novo amanhã e a tela já
      explica que ainda não chegou boletim.

      Só quando a central não tem NADA: trocar de central de volta para uma já
      importada não dispara requisição nenhuma.
    */
    if (input.centralCode) {
      const jaTem = await prisma.ceasaQuote.findFirst({
        where: { centralCode: input.centralCode },
        select: { quoteDate: true },
      });
      if (!jaTem) agendarPartidaAFrio(input.centralCode);
    }
  },

  async vincular(
    input: { productId: string; ceasaProductId: string; unit?: string | null },
    ctx: TenantCtx,
  ) {
    const meu = await prisma.product.findFirst({
      where: { id: input.productId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    // O produto é conferido CONTRA O TENANT: sem isso, um id de outra empresa
    // criaria vínculo cruzado — a única superfície do módulo em que isso seria
    // possível, já que o resto é dado público.
    //
    // Conferido ANTES do item do boletim, e não em paralelo, para o erro ser
    // sempre o mesmo quando os dois estão errados: mensagem que muda conforme a
    // ordem de resolução de duas promessas é mensagem que ninguém consegue
    // reproduzir.
    if (!meu) throw new NotFoundError("Produto não encontrado.");

    const contexto = await centralESerie(ctx.tenantId);
    if (!contexto) {
      throw new BusinessRuleError("Escolha a sua central do CEASA antes de vincular produtos.");
    }
    const doBoletim = await conferirItemDoBoletim(contexto, input);
    const unit = input.unit ?? null;

    const link = await prisma.tenantCeasaLink.upsert({
      where: { tenantId_productId: { tenantId: ctx.tenantId, productId: meu.id } },
      create: { tenantId: ctx.tenantId, productId: meu.id, ceasaProductId: doBoletim.id, unit },
      // `unit` explícito no update, e nunca `undefined`: o Prisma trata
      // `undefined` como "não mexa", então trocar o vínculo de item herdaria em
      // silêncio a embalagem do vínculo anterior — que pode não existir no item
      // novo, e aí o produto sairia da tela sem ninguém ter pedido.
      update: { ceasaProductId: doBoletim.id, unit },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "TenantCeasaLink",
      entityId: link.id,
      newData: { produto: meu.name, cotacao: doBoletim.name, embalagem: unit },
      ip: ctx.ip,
    });
    return link;
  },

  /**
   * Confirma vários vínculos de uma vez — a lista de tarefas do módulo em um
   * clique.
   *
   * Quem contrata o módulo com 40 produtos cadastrados abria a tela de vínculo e
   * repetia 40 vezes a mesma sequência (escolher, confirmar, esperar o recarregar
   * da página). A tela agora propõe a lista inteira e este método grava o que o
   * cliente confirmou.
   *
   * Valida TUDO antes de gravar QUALQUER COISA, e grava numa transação: lote
   * pela metade é pior que erro, porque o cliente não tem como saber onde parou —
   * e "confirmei 40, apareceram 23" não tem explicação possível na tela.
   *
   * NÃO cria alerta de preço junto. A tentação existe (o vínculo já diz de que
   * produto a pessoa se interessa), mas o aviso diário por push sai sempre que há
   * QUALQUER aviso pendente: alertas em lote converteriam a notificação de "só
   * quando há algo a tratar" em "todo dia, para sempre", e quem desliga isso
   * perde junto o aviso de fiado vencido. Alerta é escalada pedida, um a um.
   */
  async vincularEmLote(
    input: { itens: { productId: string; ceasaProductId: string; unit?: string | null }[] },
    ctx: TenantCtx,
  ) {
    if (input.itens.length === 0) throw new BusinessRuleError("Nenhum vínculo para confirmar.");

    const contexto = await centralESerie(ctx.tenantId);
    if (!contexto) {
      throw new BusinessRuleError("Escolha a sua central do CEASA antes de vincular produtos.");
    }

    // Um produto por vínculo: a chave única é (tenantId, productId), então o
    // mesmo produto duas vezes no lote seria o cliente pedindo duas coisas
    // contraditórias e a segunda venceria em silêncio.
    const produtoIds = input.itens.map((i) => i.productId);
    if (new Set(produtoIds).size !== produtoIds.length) {
      throw new BusinessRuleError("O mesmo produto apareceu duas vezes na lista.");
    }

    const ceasaIds = [...new Set(input.itens.map((i) => i.ceasaProductId))];
    const [meus, doBoletim, cotados] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: produtoIds }, tenantId: ctx.tenantId, deletedAt: null, active: true },
        select: { id: true, name: true },
      }),
      prisma.ceasaProduct.findMany({
        where: { id: { in: ceasaIds }, serie: contexto.serie },
        select: { id: true, name: true },
      }),
      // As embalagens que a praça de fato cota, para conferir o lote inteiro em
      // memória em vez de uma consulta por item.
      prisma.ceasaQuote.findMany({
        where: { centralCode: contexto.centralCode, ceasaProductId: { in: ceasaIds } },
        select: { ceasaProductId: true, unit: true },
        distinct: ["ceasaProductId", "unit"],
      }),
    ]);

    const nomeDoMeuProduto = new Map(meus.map((p) => [p.id, p.name]));
    const doBoletimPorId = new Map(doBoletim.map((c) => [c.id, c]));
    const itensCotados = new Set(cotados.map((c) => c.ceasaProductId));
    const paresCotados = new Set(cotados.map((c) => chaveDaSerie(c.ceasaProductId, c.unit)));

    for (const item of input.itens) {
      if (!nomeDoMeuProduto.has(item.productId)) {
        throw new NotFoundError("Produto não encontrado.");
      }
      const alvo = doBoletimPorId.get(item.ceasaProductId);
      if (!alvo) throw new NotFoundError("Produto do boletim não encontrado.");
      if (!itensCotados.has(alvo.id)) {
        throw new BusinessRuleError(`A sua central não cota ${alvo.name}.`);
      }
      if (item.unit != null && !paresCotados.has(chaveDaSerie(alvo.id, item.unit))) {
        throw new BusinessRuleError(`A sua central não cota ${alvo.name} nesta embalagem.`);
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const item of input.itens) {
        const unit = item.unit ?? null;
        await tx.tenantCeasaLink.upsert({
          where: { tenantId_productId: { tenantId: ctx.tenantId, productId: item.productId } },
          create: {
            tenantId: ctx.tenantId,
            productId: item.productId,
            ceasaProductId: item.ceasaProductId,
            unit,
          },
          update: { ceasaProductId: item.ceasaProductId, unit },
        });
      }
      /*
        UM registro de auditoria para o lote, não N.

        `/atividades` é a lista que o dono do box lê em linguagem simples. Quarenta
        linhas "vínculo de cotação atualizado" no mesmo minuto afogariam o resto do
        dia dele — a venda, o fiado, a despesa — que é justamente o que ele vai
        procurar ali.
      */
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "TenantCeasaLink",
          entityId: ctx.tenantId,
          newData: {
            quantidade: input.itens.length,
            produtos: input.itens.map((i) => nomeDoMeuProduto.get(i.productId)),
          },
          ip: ctx.ip,
        },
        tx,
      );
    });

    return { vinculados: input.itens.length };
  },

  async desvincular(input: { productId: string }, ctx: TenantCtx) {
    const r = await prisma.tenantCeasaLink.deleteMany({
      where: { tenantId: ctx.tenantId, productId: input.productId },
    });
    if (r.count === 0) throw new BusinessRuleError("Este produto não estava vinculado.");
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "TenantCeasaLink",
      entityId: input.productId,
      ip: ctx.ip,
    });
  },
};

/**
 * Quantos boletins o minigráfico do cartão resume.
 *
 * Oito é o que dá forma sem custar: são cerca de duas semanas onde a praça
 * publica todo dia útil, e um mês onde publica duas vezes por semana. Medido no
 * banco local com 205 mil cotações reais, a consulta inteira sai em 1,2 ms —
 * o `DISTINCT ... LIMIT` percorre a chave primária de trás para frente e para
 * assim que junta oito datas (370 linhas varridas, não as 14.610 da praça).
 */
const BOLETINS_NO_MINIGRAFICO = 8;

function chaveDaSerie(ceasaProductId: string, unit: string): string {
  return `${ceasaProductId}|${unit}`;
}

/**
 * Preços dos últimos boletins da praça, agrupados por produto+embalagem.
 *
 * Uma consulta só para os dois usos do cartão — o preço anterior e o
 * minigráfico —, porque são a mesma leitura: a série recente. Fazer duas seria
 * pagar o mesmo percurso de índice duas vezes por abertura de tela.
 *
 * O recorte por SÉRIE se repete dentro do `WITH` de propósito. Sem ele, numa
 * praça coberta por duas fontes, as datas mais recentes poderiam ser todas de
 * uma taxonomia, e o minigráfico dos produtos da outra viria vazio sem motivo
 * aparente.
 */
async function ultimosBoletins(centralCode: string, serie: CeasaSerie) {
  const pontos = await prisma.$queryRaw<
    {
      ceasaProductId: string;
      unit: string;
      quoteDate: Date;
      refPrice: Prisma.Decimal | string;
    }[]
  >`
    WITH datas AS (
      SELECT DISTINCT q."quoteDate"
      FROM ceasa_quotes q
      JOIN ceasa_products cp ON cp.id = q."ceasaProductId" AND cp.serie = ${serie}::"CeasaSerie"
      WHERE q."centralCode" = ${centralCode}
      ORDER BY 1 DESC
      LIMIT ${BOLETINS_NO_MINIGRAFICO}
    )
    SELECT q."ceasaProductId", q.unit, q."quoteDate", q."refPrice"
    FROM ceasa_quotes q
    JOIN ceasa_products cp ON cp.id = q."ceasaProductId" AND cp.serie = ${serie}::"CeasaSerie"
    WHERE q."centralCode" = ${centralCode}
      AND q."quoteDate" IN (SELECT "quoteDate" FROM datas)
    ORDER BY q."quoteDate" ASC
  `;

  const porProduto = new Map<string, { quoteDate: number; refPrice: Prisma.Decimal }[]>();
  for (const p of pontos) {
    const chave = chaveDaSerie(p.ceasaProductId, p.unit);
    const lista = porProduto.get(chave) ?? [];
    lista.push({ quoteDate: p.quoteDate.getTime(), refPrice: p.refPrice as Prisma.Decimal });
    porProduto.set(chave, lista);
  }
  return porProduto;
}

/**
 * Produtos ativos da empresa que ainda não apontam para nenhuma cotação.
 *
 * O `tenantId` DENTRO do `none` não é redundante: este serviço usa o `prisma`
 * cru — as tabelas do boletim são globais —, então a extensão multi-tenant não
 * está aplicando filtro nenhum, e sem ele o predicado leria "não tem vínculo de
 * ninguém". Hoje daria no mesmo, porque `vincular` confere o produto contra o
 * tenant; custa zero e fecha a porta.
 */
async function semVinculo(tenantId: string) {
  return prisma.product.findMany({
    where: { tenantId, deletedAt: null, active: true, ceasaLinks: { none: { tenantId } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Agenda a importação da praça para depois da resposta, se der.
 *
 * `after` do Next SÓ funciona dentro de um escopo de requisição, e LANÇA fora
 * dele. Isso importa porque `escolherCentral` já gravou — a central e o `audit`
 * estão commitados quando esta linha roda. Deixar a exceção subir devolveria erro
 * para uma operação que DEU CERTO: o cliente veria "não foi possível salvar",
 * recarregaria a tela e encontraria a central trocada.
 *
 * Sem escopo de requisição a única coisa que se perde é o aquecimento: o cron da
 * tarde importa a praça de qualquer forma, e a tela já explica que o boletim
 * ainda não chegou. É o desfecho certo para um efeito que é conveniência.
 *
 * (O mesmo padrão em `signup.service.ts` roda sempre dentro de um route handler,
 * então lá o escopo existe por construção.)
 */
function agendarPartidaAFrio(centralCode: string): void {
  try {
    after(async () => {
      const { CotacoesImportService } = await import("./cotacoes-import.service");
      await CotacoesImportService.importarCentral(centralCode).catch(() => {
        // O serviço já registra a falha e avisa o super-admin; aqui só não se
        // pode deixar a exceção escapar para o runtime.
      });
    });
  } catch {
    // Fora de requisição (script, teste, cron). Ver o doc acima.
  }
}

export interface CentralDaEmpresa {
  centralCode: string;
  serie: CeasaSerie;
}

/** A praça da empresa e a taxonomia que ela publica. `null` sem central. */
async function centralESerie(tenantId: string): Promise<CentralDaEmpresa | null> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { ceasaCentralCode: true, ceasaCentral: { select: { sourceKey: true } } },
  });
  if (!t?.ceasaCentralCode) return null;
  return {
    centralCode: t.ceasaCentralCode,
    serie: serieDaFonte(t.ceasaCentral?.sourceKey ?? "manual"),
  };
}

/**
 * O item do boletim existe, é da taxonomia da praça, e a praça o cota — nesta
 * embalagem, quando uma foi escolhida.
 *
 * As três conferências juntas, e num lugar só, porque as três falham do MESMO
 * jeito: gravam um vínculo que nunca encontra preço. O produto então aparece
 * como "sem cotação" para sempre, sem nada na tela explicando por quê — e a
 * pessoa não tem como suspeitar que o problema é o vínculo, não a praça.
 *
 * A auditoria de 07/09 corrigiu isso na TELA de vínculo (que passou a oferecer
 * só o que a praça cota), mas a escrita continuou aceitando qualquer id que
 * existisse no catálogo global. Tela não é validação: a Server Action é um POST.
 */
export async function conferirItemDoBoletim(
  contexto: CentralDaEmpresa,
  input: { ceasaProductId: string; unit?: string | null },
): Promise<{ id: string; name: string }> {
  const produto = await prisma.ceasaProduct.findUnique({
    where: { id: input.ceasaProductId },
    select: { id: true, name: true, serie: true },
  });
  if (!produto) throw new NotFoundError("Produto do boletim não encontrado.");
  if (produto.serie !== contexto.serie) {
    throw new BusinessRuleError("Este produto não é cotado pela sua central.");
  }

  const cotado = await prisma.ceasaQuote.findFirst({
    where: {
      centralCode: contexto.centralCode,
      ceasaProductId: produto.id,
      // Embalagem não escolhida ("qualquer") só exige que a praça cote o item.
      ...(input.unit == null ? {} : { unit: input.unit }),
    },
    select: { quoteDate: true },
  });
  if (!cotado) {
    throw new BusinessRuleError(
      input.unit == null
        ? "A sua central não cota este produto."
        : "A sua central não cota este produto nesta embalagem.",
    );
  }
  return { id: produto.id, name: produto.name };
}

/** Um item do boletim daquela praça, com as embalagens em que ela o cota. */
export interface ItemDoBoletim {
  id: string;
  name: string;
  unidades: string[];
}

/**
 * Os itens que a praça cota, com suas embalagens.
 *
 * `ARRAY_AGG(DISTINCT ...)` em vez de uma segunda consulta por produto: são
 * algumas centenas de itens e uma volta ao banco, contra N voltas.
 *
 * Considera todo o histórico da praça, e não só o último boletim, de propósito —
 * é o mesmo recorte que esta tela já usava. Item fora de safra desaparece do
 * boletim por semanas; oferecer só o que saiu hoje faria o cliente não conseguir
 * vincular metade do que ele vende, justamente na entressafra.
 */
async function unidadesPorProdutoDoBoletim(
  centralCode: string,
  serie: CeasaSerie,
): Promise<ItemDoBoletim[]> {
  return prisma.$queryRaw<ItemDoBoletim[]>`
    SELECT cp.id,
           cp.name,
           ARRAY_AGG(DISTINCT q.unit ORDER BY q.unit) AS unidades
    FROM ceasa_products cp
    JOIN ceasa_quotes q
      ON q."ceasaProductId" = cp.id AND q."centralCode" = ${centralCode}
    WHERE cp.serie = ${serie}::"CeasaSerie" AND cp.active = true
    GROUP BY cp.id, cp.name
    ORDER BY cp.name ASC
  `;
}

interface VinculoDaEmpresa {
  produtoId: string;
  produtoNome: string;
  ceasaProductId: string;
  ceasaProductName: string;
  unit: string | null;
}

/** Os vínculos da empresa, com os dois nomes — o dela e o do boletim. */
async function vinculosDaEmpresa(tenantId: string): Promise<VinculoDaEmpresa[]> {
  const links = await prisma.tenantCeasaLink.findMany({
    where: { tenantId, product: { deletedAt: null, active: true } },
    select: {
      unit: true,
      product: { select: { id: true, name: true } },
      ceasaProduct: { select: { id: true, name: true } },
    },
    orderBy: { product: { name: "asc" } },
  });
  return links.map((l) => ({
    produtoId: l.product.id,
    produtoNome: l.product.name,
    ceasaProductId: l.ceasaProduct.id,
    ceasaProductName: l.ceasaProduct.name,
    unit: l.unit,
  }));
}

/**
 * Escore em que o nome normalizado é IDÊNTICO — ver `sugerirVinculos`.
 *
 * Só este valor entra na contagem. Prefixo (0,9 e 0,8) e semelhança de tokens
 * (abaixo disso) são bons para ORDENAR a lista de sugestões e ruins para
 * prometer: "Tomate" tem prefixo comum com "Tomate cereja", que é outro preço.
 * Um número na tela dizendo "9 já têm o nome exato" tem de ser verdade.
 */
const ESCORE_NOME_IDENTICO = 1;

/**
 * Quantos produtos sem vínculo têm nome idêntico a um item do boletim de hoje.
 *
 * Em memória sobre o boletim já carregado. São algumas dezenas de produtos
 * contra algumas centenas de itens, comparando conjuntos de tokens curtos — o
 * custo é ruído ao lado das duas consultas que a tela já faz, e ir ao banco de
 * novo para responder isso seria pagar caro por um número de cabeçalho.
 */
function comNomeIdentico(
  sem: { id: string; name: string }[],
  rows: { ceasaProductId: string; ceasaProductName: string }[],
): number {
  if (sem.length === 0 || rows.length === 0) return 0;
  const itens = [...new Map(rows.map((r) => [r.ceasaProductId, r.ceasaProductName])).entries()].map(
    ([id, name]) => ({ id, name }),
  );
  return sem.filter((p) => {
    const melhor = sugerirVinculos(p.name, itens, (c) => c.name, 1)[0];
    return melhor !== undefined && melhor.escore >= ESCORE_NOME_IDENTICO;
  }).length;
}

/**
 * Quais vínculos ficaram sem preço no boletim de hoje.
 *
 * Vínculo com embalagem escolhida some quando a praça não publicou AQUELA
 * embalagem; vínculo sem embalagem some só quando o item inteiro faltou. Os dois
 * casos precisam de nome na tela — some silenciosamente é o desfecho proibido.
 */
function vinculosSemCotacao(
  vinculos: VinculoDaEmpresa[],
  rows: { ceasaProductId: string; unit: string }[],
) {
  const itensDoBoletim = new Set(rows.map((r) => r.ceasaProductId));
  const paresDoBoletim = new Set(rows.map((r) => chaveDaSerie(r.ceasaProductId, r.unit)));

  return vinculos
    .filter((v) =>
      v.unit === null
        ? !itensDoBoletim.has(v.ceasaProductId)
        : !paresDoBoletim.has(chaveDaSerie(v.ceasaProductId, v.unit)),
    )
    .map((v) => ({
      produtoId: v.produtoId,
      produtoNome: v.produtoNome,
      ceasaProductName: v.ceasaProductName,
      unit: v.unit,
    }));
}

function dec(v: Prisma.Decimal | string | null): Prisma.Decimal | null {
  if (v === null || v === undefined) return null;
  return v as Prisma.Decimal;
}
