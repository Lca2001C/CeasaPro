import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { describeError, logger } from "@/lib/logger";
import { toDecimal, money, add } from "@/lib/money";
import { FinancialCalc } from "./financial-calc.service";
import { passaDoEstoque } from "@/lib/estoque/nivel";
import {
  ORIGEM_AJUSTE,
  ORIGEM_AJUSTE_DESFEITO,
  ORIGEM_COMPRA,
  ORIGEM_COMPRA_CANCELADA,
} from "@/lib/estoque/origens";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/http/app-error";
import {
  HORAS_PARA_DESFAZER,
  dentroDoPrazoDeDesfazer,
  foraDoPrazoDeDesfazer,
  podeDesfazer,
} from "@/lib/desfazer/prazo";
import type { AjusteEstoqueInput } from "@/lib/validations/estoque";
import { comIdempotencia } from "@/lib/http/idempotencia";
import type { TenantCtx } from "@/lib/http/with-action";

export interface StockPosition {
  productId: string;
  name: string;
  saleUnit: string;
  quantity: Prisma.Decimal;
  avgCost: Prisma.Decimal;
  value: Prisma.Decimal;
  lastMovementAt: Date | null;
  /** Alerta de estoque do produto (nulo = limite padrão). */
  minStock: Prisma.Decimal | null;
}

/**
 * Estoque é DERIVADO do ledger `stock_movements` (nunca coluna mutável).
 * Saldo = Σ(ENTRADA, AJUSTE) − Σ(SAIDA, QUEBRA, DOACAO).
 * Todas as consultas filtram por tenantId explicitamente (raw SQL não passa pela extensão).
 */
/**
 * Custo médio PONDERADO MÓVEL do estoque ATUAL — uma consulta só, usada pela
 * venda (`unitCostAtSale`), pelo ajuste manual, pela tela de Estoque e pelo
 * valor em estoque do painel, para não voltarem a divergir.
 *
 * ## O método
 *
 * É o custo médio ponderado móvel (o "custo médio" do CPC 16 e do fisco):
 * o livro-razão do produto é repassado em ordem e
 *
 *   - toda ENTRADA (e todo AJUSTE positivo) muda a média:
 *       média = (saldo_antes × média + qtde × custo) / (saldo_antes + qtde)
 *   - toda saída (SAIDA, QUEBRA, DOACAO, AJUSTE negativo) sai PELA média e não
 *     a altera;
 *   - quando o saldo chega a zero (ou abaixo), a média recomeça: a próxima
 *     entrada vale pelo próprio custo. Mercadoria que já saiu não pesa mais.
 *
 * O valor do estoque é `saldo × média` — o cartão do produto fecha com a conta
 * que o operador faz de cabeça, e com saldo zero o valor é zero.
 *
 * ## Por que mudou (duas vezes)
 *
 * 1. Era média ARITMÉTICA (`AVG(unitCost)`): 100 cx a R$ 1 + 1 cx a R$ 100
 *    dava R$ 50,50 em vez de R$ 1,98.
 * 2. Depois virou a média ponderada de TODAS as entradas da história, sem
 *    descontar o que já saiu. Julho: 100 cx a R$ 50, todas vendidas. Setembro:
 *    100 cx a R$ 120. O custo era (5.000 + 12.000) / 200 = R$ 85 — vender a
 *    R$ 110 aparecia como lucro de R$ 25/cx quando era prejuízo de R$ 10/cx, e
 *    depois de vender tudo sobrava R$ 3.500 de "valor em estoque" com saldo
 *    zero no painel. Com preço de hortifruti mudando toda semana, em poucos
 *    meses o custo de toda venda virava a média do histórico inteiro.
 *
 * ## Decisões
 *
 * - **Ordem = `createdAt`, não `movedAt`.** `movedAt` de compra é a data
 *   digitada, à meia-noite: a compra de hoje lançada às 10h ficaria ANTES das
 *   vendas das 9h que zeraram o produto, e o ciclo nunca recomeçaria. A ordem
 *   de gravação é a ordem em que o sistema validou saldo e atribuiu custo a
 *   cada venda, então o repasse reproduz o custo que cada venda viu.
 * - **O custo gravado nas saídas é ignorado.** A saída sai pela média do
 *   repasse, qualquer que seja o `unitCost` dela. Assim o histórico gravado
 *   com a fórmula antiga (saídas a R$ 85 no exemplo) não contamina a média de
 *   hoje. Para o que foi gravado daqui em diante, dá o mesmo número.
 * - **Sem saldo**, o custo de referência é o da última entrada (é o que um
 *   AJUSTE positivo sem custo informado herda). O valor, nesse caso, é zero.
 * - **Nada foi reescrito**: `unitCostAtSale` de venda antiga continua o que
 *   era. A correção vale para as vendas novas.
 *
 * ## Como o SQL faz o repasse sem laço
 *
 * O repasse é sequencial, mas tem forma fechada. Dentro do ciclo atual (as
 * linhas depois da última vez que o saldo ficou ≤ 0), cada saída multiplica o
 * valor acumulado por saldo_depois / saldo_antes. Entre duas entradas esses
 * fatores se cancelam em cadeia, então a entrada k é "encolhida" por
 * r_k = saldo antes da próxima entrada / saldo logo depois dela (a última usa
 * o saldo final). Cada entrada i vale `qtde × custo × Π_{k≥i} r_k`, e o
 * produto sai como `EXP(soma dos LN)` numa janela em ordem decrescente — só
 * nas linhas de entrada, que são poucas. Tudo em `numeric`; o peso abaixo de
 * e^−40 é zerado (não muda a 4ª casa e evita `EXP` com milhares de dígitos).
 * `tests/integration/estoque-custo-ajuste.test.ts` confere o SQL contra um
 * repasse linha a linha em TypeScript.
 *
 * ## Compra cancelada
 *
 * A ENTRADA da compra cancelada e o estorno dela (`ORIGEM_COMPRA_CANCELADA`)
 * ficam no livro-razão — o histórico do produto mostra os dois — mas saem
 * JUNTOS do repasse: a compra digitada errada não existiu, e o custo dela não
 * pode continuar pesando na média. Um estorno comum (saída pela média) tiraria
 * a quantidade e deixaria o preço errado misturado no custo de toda venda
 * seguinte. Como o par soma zero, o saldo das consultas simples (que somam o
 * livro-razão inteiro) fecha com o daqui.
 *
 * ## Checkpoint
 *
 * O livro-razão só cresce, e o repasse relia a história inteira do produto a
 * cada venda. `stock_cost_checkpoints` guarda o estado do repasse (saldo,
 * média sem arredondar, custo da última entrada, último `movedAt`) até um
 * instante `ateCreatedAt`; o repasse começa dele, como uma linha-semente
 * (entrada de `saldo` unidades a `custo`), e lê só os movimentos gravados
 * depois. A conta é a mesma: o valor acumulado no checkpoint é `saldo × média`,
 * exatamente o que a semente põe no ciclo. Com saldo ≤ 0 a semente zera o
 * ciclo, como o movimento que o zerou faria. A última entrada e o último
 * `movedAt` vêm do checkpoint quando não há movimento novo que os substitua.
 *
 * Os pares cancelados continuam certos mesmo atravessando o checkpoint: o
 * `NOT EXISTS` procura o estorno no livro-razão INTEIRO, e o checkpoint só cobre
 * movimentos com mais de 24 h (o prazo de desfazer), cujo estorno, se houver,
 * já está gravado quando o checkpoint é calculado.
 *
 * `ate` (só para montar o checkpoint) corta o repasse num instante.
 */
function sqlCustoEstoque(filtrarProdutos: boolean, ate?: string): string {
  const porProduto = filtrarProdutos ? ` AND "productId" = ANY($2::text[])` : "";
  return `
  WITH ck AS (
    SELECT "productId", "ateCreatedAt", saldo, custo, deslocamento, "ultimoCustoEntrada", "ultimoMovedAt"
    FROM stock_cost_checkpoints
    WHERE "tenantId" = $1${porProduto}
  ),
  base AS (
    SELECT m."productId", m."movedAt", m."createdAt", m.id, 1 AS ordem,
           CASE WHEN m.type IN ('ENTRADA','AJUSTE') THEN m.quantity ELSE -m.quantity END AS q,
           m."unitCost" AS c
    FROM stock_movements m
    WHERE m."tenantId" = $1${filtrarProdutos ? ` AND m."productId" = ANY($2::text[])` : ""}
      -- Limite inferior comum (usa o índice); o corte exato por produto vem abaixo.
      AND m."createdAt" > (SELECT COALESCE(MIN("ateCreatedAt"), '-infinity'::timestamp) FROM ck)
      AND NOT EXISTS (
        SELECT 1 FROM ck WHERE ck."productId" = m."productId" AND m."createdAt" <= ck."ateCreatedAt"
      )${ate ? `\n      AND m."createdAt" <= ${ate}` : ""}
      AND NOT EXISTS (
        SELECT 1 FROM stock_movements estorno
        WHERE m."sourceType" IN ('${ORIGEM_COMPRA}', '${ORIGEM_COMPRA_CANCELADA}')
          AND estorno."tenantId" = m."tenantId"
          AND estorno."sourceType" = '${ORIGEM_COMPRA_CANCELADA}'
          AND estorno."sourceId" = m."sourceId"
      )
      -- Ajuste manual desfeito: o ajuste e o estorno dele saem JUNTOS (o custo
      -- digitado errado não fica na média; o par soma zero no saldo).
      AND NOT EXISTS (
        SELECT 1 FROM stock_movements estorno
        WHERE m."sourceType" IN ('${ORIGEM_AJUSTE}', '${ORIGEM_AJUSTE_DESFEITO}')
          AND estorno."tenantId" = m."tenantId"
          AND estorno."sourceType" = '${ORIGEM_AJUSTE_DESFEITO}'
          AND estorno."sourceId" =
            CASE WHEN m."sourceType" = '${ORIGEM_AJUSTE}' THEN m.id ELSE m."sourceId" END
      )
    -- Semente em DUAS linhas, para reproduzir o repasse completo também quando
    -- o ciclo recomeçou num saldo negativo: a primeira (deslocamento, <= 0)
    -- marca onde o ciclo zerou; a segunda é o que o ciclo acumulou desde então,
    -- pela média. Uma linha só com o saldo REAL pesava as entradas seguintes
    -- por outra quantidade (q_ciclo != saldo) e mudava o custo em silêncio.
    UNION ALL
    SELECT "productId", "ultimoMovedAt", "ateCreatedAt", '', 0, deslocamento, NULL::numeric FROM ck
    UNION ALL
    SELECT "productId", "ultimoMovedAt", "ateCreatedAt", '~', 0, saldo - deslocamento, custo
    FROM ck
    WHERE saldo - deslocamento <> 0
  ),
  mov AS (
    SELECT "productId", "movedAt", ordem, q, c,
           ROW_NUMBER() OVER w AS seq,
           SUM(q) OVER w AS saldo
    FROM base
    WINDOW w AS (PARTITION BY "productId" ORDER BY ordem, "createdAt", id)
  ),
  marcado AS (
    SELECT mov.*,
           MAX(CASE WHEN saldo <= 0 THEN seq END) OVER (PARTITION BY "productId") AS zerou_em,
           SUM(q) OVER (PARTITION BY "productId") AS saldo_final
    FROM mov
  ),
  -- Tudo pelo saldo REAL (o acumulado de \`mov\`). A primeira entrada do ciclo
  -- primeiro cobre o buraco do saldo negativo (as unidades vendidas a mais já
  -- saíram pela média antiga): ela pesa só o que sobra depois dela. Contar o
  -- ciclo a partir de zero pesava as entradas por unidades que não existem —
  -- −1, +4 a R$ 7, −2, +10 a R$ 9 dava R$ 8,67 em vez de R$ 8,82 (1 a R$ 7 e
  -- 10 a R$ 9). Sem saldo negativo as duas contas são iguais.
  ciclo AS (
    SELECT "productId", seq, q, c,
           saldo AS sc,
           CASE WHEN seq = COALESCE(zerou_em, 0) + 1 THEN saldo ELSE q END AS q_efetiva,
           saldo_final AS q_ciclo
    FROM marcado
    WHERE seq > COALESCE(zerou_em, 0)
  ),
  entradas AS (
    SELECT "productId", seq, q, q_efetiva, c, sc, q_ciclo,
           COALESCE(LEAD(sc - q) OVER (PARTITION BY "productId" ORDER BY seq), q_ciclo) AS antes_da_proxima
    FROM ciclo
    WHERE q > 0
  ),
  pesos AS (
    SELECT "productId", q_efetiva, c, q_ciclo,
           SUM(CASE WHEN antes_da_proxima = sc THEN 0 ELSE LN(antes_da_proxima / sc) END)
             OVER (PARTITION BY "productId" ORDER BY seq DESC) AS ln_peso
    FROM entradas
  ),
  medio AS (
    SELECT "productId",
           SUM(q_efetiva * COALESCE(c, 0) * CASE WHEN ln_peso < -40 THEN 0 ELSE EXP(ln_peso) END)
             / MAX(q_ciclo) AS custo
    FROM pesos
    GROUP BY "productId"
  ),
  ultima_mov AS (
    SELECT DISTINCT ON ("productId") "productId", COALESCE(c, 0) AS custo
    FROM mov
    WHERE q > 0 AND ordem = 1
    ORDER BY "productId", seq DESC
  ),
  -- A semente não é entrada de verdade: sem entrada nova, vale a do checkpoint.
  ultima AS (
    SELECT COALESCE(u."productId", ck."productId") AS "productId",
           COALESCE(u.custo, ck."ultimoCustoEntrada") AS custo
    FROM ultima_mov u
    FULL JOIN ck ON ck."productId" = u."productId"
  ),
  saldo AS (
    SELECT "productId", SUM(q) AS quantidade, MAX("movedAt") AS ultimo_mov
    FROM mov
    GROUP BY "productId"
  ),
  -- Saldo real na linha onde o ciclo atual começou (<= 0; 0 sem recomeço).
  desloc AS (
    SELECT "productId", saldo AS deslocamento
    FROM marcado
    WHERE seq = zerou_em
  ),
  resultado AS (
    SELECT s."productId", s.quantidade, s.ultimo_mov,
           COALESCE(d.deslocamento, 0) AS deslocamento,
           ROUND(CASE WHEN s.quantidade > 0 THEN m.custo ELSE u.custo END, 4) AS custo,
           -- Só para gravar o checkpoint: a média sem arredondar e a última entrada.
           CASE WHEN s.quantidade > 0 THEN m.custo END AS custo_bruto,
           u.custo AS ultimo_custo_entrada
    FROM saldo s
    LEFT JOIN medio m ON m."productId" = s."productId"
    LEFT JOIN ultima u ON u."productId" = s."productId"
    LEFT JOIN desloc d ON d."productId" = s."productId"
  )`;
}

/**
 * Checkpoints do custo médio ficam pelo menos isto no passado. Precisa passar
 * do prazo de desfazer (24 h): ver "Checkpoint" em {@link sqlCustoEstoque}.
 */
export const IDADE_MINIMA_CHECKPOINT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Valor de UMA linha de estoque: saldo × custo médio, zero sem saldo.
 *
 * Saldo ≤ 0 vale zero, e não `saldo × custo` negativo: é o mesmo critério da
 * tela de Estoque (`nivelEstoque` trata ≤ 0 como "zerado" e não soma), então o
 * cartão do painel e a tela dão o mesmo número.
 */
function valorDaLinha(quantidade: Prisma.Decimal, custo: Prisma.Decimal): Prisma.Decimal {
  if (quantidade.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);
  return FinancialCalc.valorTotalEstoque([{ quantidade, custoUnitario: custo }]);
}

/** Executor mínimo aceito — o cliente base ou um `tx` de transação. */
type CustoTxClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

/**
 * Custo médio ponderado MÓVEL do estoque atual, por produto (ver
 * {@link sqlCustoEstoque}). Sem saldo, o custo da última entrada. Chave
 * ausente = produto sem entrada nenhuma.
 */
export async function custoMedioPonderado(
  tx: CustoTxClient,
  tenantId: string,
  productIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx.$queryRawUnsafe<{ productId: string; custo: Prisma.Decimal | string }[]>(
    `${sqlCustoEstoque(true)}
     SELECT "productId", custo FROM resultado WHERE custo IS NOT NULL`,
    tenantId,
    productIds,
  );
  return new Map(rows.map((r) => [r.productId, toDecimal(r.custo as Prisma.Decimal.Value)]));
}

/**
 * Saldo E custo médio dos produtos, numa consulta só — o que a venda precisa
 * dentro da transação, com os produtos travados (`FOR UPDATE`).
 *
 * A venda fazia um `groupBy` de saldo e, depois, `custoMedioPonderado`: duas
 * varreduras das MESMAS linhas do livro-razão, em sequência na conexão da
 * transação, com o produto travado o tempo todo. O CTE de custo já calcula o
 * saldo (`resultado.quantidade`, mesma regra de sinal: ENTRADA/AJUSTE somam).
 * Produto sem movimento não aparece — saldo zero, sem custo.
 */
export async function saldoECustoMedio(
  tx: CustoTxClient,
  tenantId: string,
  productIds: string[],
): Promise<{ saldo: Map<string, Prisma.Decimal>; custo: Map<string, Prisma.Decimal> }> {
  const saldo = new Map<string, Prisma.Decimal>();
  const custo = new Map<string, Prisma.Decimal>();
  if (productIds.length === 0) return { saldo, custo };
  const rows = await tx.$queryRawUnsafe<
    { productId: string; quantidade: Prisma.Decimal | string; custo: Prisma.Decimal | string | null }[]
  >(
    `${sqlCustoEstoque(true)}
     SELECT "productId", quantidade, custo FROM resultado`,
    tenantId,
    productIds,
  );
  for (const r of rows) {
    saldo.set(r.productId, toDecimal(r.quantidade as Prisma.Decimal.Value));
    if (r.custo !== null) custo.set(r.productId, toDecimal(r.custo as Prisma.Decimal.Value));
  }
  return { saldo, custo };
}

/** O movimento TIRA do estoque? (`AJUSTE` negativo é acerto de inventário para baixo.) */
function retiraDoEstoque(input: AjusteEstoqueInput): boolean {
  if (input.type === "QUEBRA" || input.type === "DOACAO") return true;
  return input.type === "AJUSTE" && input.quantity < 0;
}

/** Saldo do produto lido DENTRO da transação, depois do lock. */
export async function saldoNaTransacao(
  tx: { $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> },
  tenantId: string,
  productId: string,
): Promise<Prisma.Decimal> {
  const rows = await tx.$queryRawUnsafe<{ quantity: Prisma.Decimal | string }[]>(
    `SELECT COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END), 0) AS quantity
     FROM stock_movements WHERE "tenantId" = $1 AND "productId" = $2`,
    tenantId,
    productId,
  );
  return toDecimal((rows[0]?.quantity ?? 0) as Prisma.Decimal.Value);
}

export const EstoqueService = {
  /** Posição atual de todos os produtos com estoque calculado. */
  async getPositions(tenantId: string): Promise<StockPosition[]> {
    const rows = await prisma.$queryRawUnsafe<
      {
        productId: string;
        name: string;
        saleUnit: string;
        quantity: Prisma.Decimal | string;
        custo: Prisma.Decimal | string;
        lastmovementat: Date | null;
        minStock: Prisma.Decimal | string | null;
      }[]
    >(
      `${sqlCustoEstoque(false)}
       SELECT p.id AS "productId",
              p.name AS name,
              p."saleUnit"::text AS "saleUnit",
              COALESCE(r.quantidade, 0) AS quantity,
              COALESCE(r.custo, 0) AS custo,
              r.ultimo_mov AS lastmovementat,
              p."minStock" AS "minStock"
       FROM products p
       LEFT JOIN resultado r ON r."productId" = p.id
       WHERE p."tenantId" = $1 AND p."deletedAt" IS NULL
       ORDER BY p.name ASC`,
      tenantId,
    );
    return rows.map((r) => {
      const quantity = toDecimal(r.quantity as Prisma.Decimal.Value);
      const custo = toDecimal(r.custo as Prisma.Decimal.Value);
      return {
        productId: r.productId,
        name: r.name,
        saleUnit: r.saleUnit,
        quantity,
        avgCost: money(custo),
        // Com o custo de 4 casas, não com o de tela (2 casas): é o mesmo
        // número que a venda grava em `unitCostAtSale`.
        value: valorDaLinha(quantity, custo),
        lastMovementAt: r.lastmovementat,
        minStock: r.minStock == null ? null : toDecimal(r.minStock as Prisma.Decimal.Value),
      };
    });
  },

  /**
   * Só o SALDO de cada produto, sem custo — para quem não mostra valor.
   *
   * O PDV usava `getPositions` só pelas quantidades, e desde que o custo virou
   * média ponderada móvel (`sqlCustoEstoque`, janela sobre o livro-razão) isso
   * punha a conta de custo no carregamento da tela mais sensível a latência
   * do sistema. A soma simples com sinal é a mesma que `getQuantity` usa.
   */
  async getQuantidades(tenantId: string): Promise<Record<string, number>> {
    const rows = await prisma.$queryRaw<{ productId: string; quantity: Prisma.Decimal | string }[]>`
      SELECT m."productId",
             SUM(CASE WHEN m.type IN ('ENTRADA','AJUSTE') THEN m.quantity ELSE -m.quantity END) AS quantity
      FROM stock_movements m
      JOIN products p ON p.id = m."productId" AND p."tenantId" = ${tenantId} AND p."deletedAt" IS NULL
      WHERE m."tenantId" = ${tenantId}
      GROUP BY m."productId"
    `;
    const saldo: Record<string, number> = {};
    for (const r of rows) saldo[r.productId] = Number(r.quantity);
    return saldo;
  },

  /** Quantidade atual de um produto (para validar disponibilidade em venda). */
  async getQuantity(tenantId: string, productId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.$queryRaw<{ quantity: Prisma.Decimal | string }[]>`
      SELECT COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END), 0) AS quantity
      FROM stock_movements
      WHERE "tenantId" = ${tenantId} AND "productId" = ${productId}
    `;
    return toDecimal((rows[0]?.quantity ?? 0) as Prisma.Decimal.Value);
  },

  /**
   * Valor total em estoque (para o painel).
   *
   * A junção com `products` e o filtro de `deletedAt` NÃO são detalhe: sem eles,
   * esta conta e a da tela de Estoque (`getPositions`, que filtra produto
   * excluído) davam números diferentes para a mesma pergunta. Um produto com
   * 100 unidades a R$ 10,00 excluído sumia da tela de Estoque e continuava
   * valendo R$ 1.000 no cartão do painel e no snapshot do PWA — na mesma sessão.
   *
   * Pelo mesmo motivo é a soma das MESMAS linhas de `getPositions` (mesma
   * {@link sqlCustoEstoque}, mesma junção, mesmo `valorDaLinha`), e não uma
   * conta própria: `Σ(qtde com sinal × unitCost)` do livro-razão deixava valor
   * residual em produto de saldo zero (R$ 3.500 no exemplo de
   * {@link sqlCustoEstoque}), que a tela escondia e o painel mostrava. Só não
   * busca nome, unidade nem data: o painel quer o total.
   */
  /**
   * O valor total a partir de posições JÁ calculadas — o mesmo número de
   * `getTotalValue` (mesma `valorDaLinha` por produto, arredondado uma vez no
   * fim), sem rodar de novo o custo sobre o livro-razão inteiro.
   */
  valorTotalDasPosicoes(posicoes: { value: Prisma.Decimal }[]): Prisma.Decimal {
    return money(add(...posicoes.map((p) => p.value)));
  },

  async getTotalValue(tenantId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.$queryRawUnsafe<
      { quantity: Prisma.Decimal | string; custo: Prisma.Decimal | string }[]
    >(
      `${sqlCustoEstoque(false)}
       SELECT COALESCE(r.quantidade, 0) AS quantity,
              COALESCE(r.custo, 0) AS custo
       FROM products p
       LEFT JOIN resultado r ON r."productId" = p.id
       WHERE p."tenantId" = $1 AND p."deletedAt" IS NULL`,
      tenantId,
    );
    return money(
      add(
        ...rows.map((r) =>
          valorDaLinha(
            toDecimal(r.quantity as Prisma.Decimal.Value),
            toDecimal(r.custo as Prisma.Decimal.Value),
          ),
        ),
      ),
    );
  },

  /**
   * Ajustes manuais das últimas 24 h ainda não desfeitos — a lista da tela de
   * ajuste, com o botão "Desfazer".
   */
  async ajustesRecentes(tenantId: string, agora = new Date()) {
    const db = getTenantPrisma(tenantId);
    const desde = new Date(agora.getTime() - HORAS_PARA_DESFAZER * 3600_000);
    const ajustes = await db.stockMovement.findMany({
      where: { sourceType: ORIGEM_AJUSTE, createdAt: { gte: desde }, product: { deletedAt: null } },
      include: { product: { select: { name: true, saleUnit: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (ajustes.length === 0) return [];
    const desfeitos = await db.stockMovement.findMany({
      where: { sourceType: ORIGEM_AJUSTE_DESFEITO, sourceId: { in: ajustes.map((a) => a.id) } },
      select: { sourceId: true },
    });
    const jaDesfeitos = new Set(desfeitos.map((d) => d.sourceId));
    const vivos = ajustes.filter((a) => !jaDesfeitos.has(a.id));
    // A mesma regra de `desfazerAjuste`: com movimento do produto depois, o
    // servidor recusa — a tela mostra o motivo em vez do botão.
    const comMovimentoDepois = new Set<string>();
    if (vivos.length > 0) {
      const linhas = await prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT a.id
        FROM stock_movements a
        JOIN stock_movements m
          ON m."tenantId" = a."tenantId" AND m."productId" = a."productId"
         AND (m."createdAt" > a."createdAt" OR (m."createdAt" = a."createdAt" AND m.id > a.id))
        WHERE a."tenantId" = ${tenantId} AND a.id = ANY(${vivos.map((a) => a.id)}::text[])
      `;
      for (const l of linhas) comMovimentoDepois.add(l.id);
    }
    return vivos.map((a) => ({ ...a, podeDesfazer: !comMovimentoDepois.has(a.id) }));
  },

  /**
   * Desfaz um ajuste manual lançado errado — a regra única de desfazer
   * (`src/lib/desfazer/prazo.ts`): até 24 h, só o dono, e nunca apagando a
   * linha. Entra um AJUSTE espelhado (`MANUAL_CANCELLED`) que devolve a
   * quantidade, e o par sai do repasse do custo médio (`sqlCustoEstoque`): um
   * custo digitado errado (R$ 5.000 em vez de R$ 50) deixa de contaminar a
   * média.
   *
   * Recusa se o produto teve QUALQUER movimento depois do ajuste: esses
   * movimentos já gravaram o custo médio daquela hora (a venda no
   * `unitCostAtSale`), e tirar o ajuste do passado deixaria o CMV deles errado
   * para sempre — a mesma regra do cancelamento de compra.
   */
  async desfazerAjuste(input: { id: string }, ctx: TenantCtx) {
    if (!podeDesfazer(ctx.session.role)) {
      throw new ForbiddenError("Só o responsável pela empresa pode desfazer um ajuste.");
    }
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const ajuste = await tx.stockMovement.findFirst({
        where: { id: input.id, sourceType: ORIGEM_AJUSTE },
      });
      if (!ajuste) throw new NotFoundError("Ajuste não encontrado");
      if (!dentroDoPrazoDeDesfazer(ajuste.createdAt)) {
        throw new BusinessRuleError(foraDoPrazoDeDesfazer("desfazer este ajuste"));
      }
      // Mesma trava do ajuste e da venda: a ordem do livro-razão do produto.
      // Produto excluído não recebe estorno: a mercadoria voltaria a um produto
      // que nenhuma tela mostra e nenhum ajuste alcança.
      const travado = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products
        WHERE "tenantId" = ${ctx.tenantId} AND id = ${ajuste.productId}
          AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (travado.length === 0) {
        throw new BusinessRuleError("O produto deste ajuste foi excluído; não dá para desfazer.");
      }
      const jaDesfeito = await tx.stockMovement.findFirst({
        where: { sourceType: ORIGEM_AJUSTE_DESFEITO, sourceId: ajuste.id },
        select: { id: true },
      });
      if (jaDesfeito) throw new BusinessRuleError("Este ajuste já foi desfeito.");
      const depois = await tx.stockMovement.count({
        where: {
          productId: ajuste.productId,
          OR: [
            { createdAt: { gt: ajuste.createdAt } },
            { createdAt: ajuste.createdAt, id: { gt: ajuste.id } },
          ],
        },
      });
      if (depois > 0) {
        throw new BusinessRuleError(
          "Este produto já teve venda, compra ou outro ajuste depois deste. Lance um novo " +
            "ajuste de acerto em vez de desfazer.",
        );
      }

      // O efeito do ajuste no saldo, com o sinal invertido. QUEBRA/DOAÇÃO tiram
      // (quantidade positiva que subtrai); AJUSTE soma a quantidade com sinal.
      const efeito =
        ajuste.type === "AJUSTE" ? toDecimal(ajuste.quantity) : toDecimal(ajuste.quantity).neg();
      const estorno = await tx.stockMovement.create({
        data: {
          tenantId: ctx.tenantId,
          productId: ajuste.productId,
          type: "AJUSTE",
          quantity: efeito.neg(),
          unitCost: ajuste.unitCost,
          movedAt: ajuste.movedAt,
          reason: "Ajuste desfeito",
          sourceType: ORIGEM_AJUSTE_DESFEITO,
          sourceId: ajuste.id,
        },
      });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "StockMovement",
          entityId: ajuste.id,
          oldData: { type: ajuste.type, quantity: ajuste.quantity.toString() },
          newData: { desfeito: true, estorno: estorno.id },
          ip: ctx.ip,
        },
        tx,
      );
      return { id: ajuste.id };
    });
  },

  /** Ajuste manual de estoque: quebra/perda, doação ou acerto. */
  async registrarAjuste(input: AjusteEstoqueInput, ctx: TenantCtx) {
    // O reenvio do MESMO ajuste (timeout depois do commit) devolve o gravado:
    // repetir lançava a quebra duas vezes.
    return comIdempotencia(
      input.idempotencyKey,
      (k) => getTenantPrisma(ctx.tenantId).stockMovement.findFirst({ where: { idempotencyKey: k } }),
      () => this.gravarAjuste(input, ctx),
    );
  },

  async gravarAjuste(input: AjusteEstoqueInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      // Trava a linha do produto ANTES de ler o saldo — mesmo motivo da venda:
      // o ledger é só-de-inserção, e sem lock duas requisições leem o mesmo
      // saldo e as duas passam.
      const travado = await tx.$queryRaw<{ id: string; name: string }[]>`
        SELECT id, name FROM products
        WHERE "tenantId" = ${ctx.tenantId} AND id = ${input.productId}
          AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      const product = travado[0];
      if (!product) throw new NotFoundError("Produto não encontrado");

      // Saldo, para o ajuste não levar o estoque a negativo.
      //
      // Não havia validação nenhuma aqui: `QUEBRA`/`DOACAO` de 999999 numa
      // posição de 10 unidades era aceita, o saldo virava −999989, o valor de
      // estoque ficava negativo no painel e o PDV passava a recusar toda venda
      // daquele produto. E não existia caminho de volta: `ajusteEstoqueSchema`
      // só aceitava quantidade positiva e `AJUSTE` sempre SOMA.
      if (retiraDoEstoque(input)) {
        const saldo = await saldoNaTransacao(tx, ctx.tenantId, input.productId);
        const pedido = toDecimal(input.quantity).abs();
        if (passaDoEstoque(saldo, pedido)) {
          throw new BusinessRuleError(
            `${product.name} tem ${saldo.toString()} em estoque. ` +
              "Confira a quantidade — o ajuste deixaria o saldo negativo.",
          );
        }
      }

      // Custo unitário: o médio móvel do estoque atual (sem saldo, o da última
      // entrada — ver `sqlCustoEstoque`). O informado só vale para o que ENTRA
      // (acerto para cima, que pondera a média). Na saída (quebra, doação,
      // acerto para baixo) a mercadoria sai pela média: aceitar o digitado
      // deixava a API lançar R$ 99.999 de perda no lucro — ou zerá-la — sem o
      // estoque ter perdido mais que a média.
      const custos = await custoMedioPonderado(tx, ctx.tenantId, [input.productId]);
      const media = custos.get(input.productId) ?? new Prisma.Decimal(0);
      const unitCost =
        input.unitCost != null && !retiraDoEstoque(input) ? toDecimal(input.unitCost) : media;

      const movement = await tx.stockMovement.create({
        data: {
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: input.type,
          quantity: input.quantity,
          unitCost,
          reason: input.reason ?? null,
          sourceType: ORIGEM_AJUSTE,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "StockMovement",
          entityId: movement.id,
          newData: { type: input.type, quantity: input.quantity, reason: input.reason },
          ip: ctx.ip,
        },
        tx,
      );

      return movement;
    });
  },

  /**
   * Avança os checkpoints do custo médio da empresa até `ate` (todos os
   * produtos, numa instrução só — ou a empresa inteira avança, ou nada).
   *
   * `ate` precisa estar além do prazo de desfazer; o padrão é
   * {@link IDADE_MINIMA_CHECKPOINT_MS} atrás. Checkpoint mais novo que `ate`
   * não é rebaixado. Devolve quantos produtos foram gravados.
   */
  async atualizarCheckpoints(
    tenantId: string,
    ate: Date = new Date(Date.now() - IDADE_MINIMA_CHECKPOINT_MS),
    db: { $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> } = prisma,
  ): Promise<number> {
    const corte = `($2::timestamptz AT TIME ZONE 'UTC')`;
    return db.$executeRawUnsafe(
      `${sqlCustoEstoque(false, corte)}
       INSERT INTO stock_cost_checkpoints
         (id, "tenantId", "productId", "ateCreatedAt", saldo, custo, deslocamento, "ultimoCustoEntrada", "ultimoMovedAt", "updatedAt")
       SELECT gen_random_uuid()::text, $1, r."productId", ${corte},
              r.quantidade, r.custo_bruto, r.deslocamento, r.ultimo_custo_entrada, r.ultimo_mov, now()
       FROM resultado r
       ON CONFLICT ("tenantId", "productId") DO UPDATE SET
         "ateCreatedAt" = EXCLUDED."ateCreatedAt",
         saldo = EXCLUDED.saldo,
         custo = EXCLUDED.custo,
         deslocamento = EXCLUDED.deslocamento,
         "ultimoCustoEntrada" = EXCLUDED."ultimoCustoEntrada",
         "ultimoMovedAt" = EXCLUDED."ultimoMovedAt",
         "updatedAt" = now()
       WHERE stock_cost_checkpoints."ateCreatedAt" < EXCLUDED."ateCreatedAt"`,
      tenantId,
      ate.toISOString(),
    );
  },

  /**
   * Avança os checkpoints de todas as empresas, as mais atrasadas primeiro,
   * até `prazo` (epoch ms). Chamado pelo cron diário; o que não couber hoje
   * vai primeiro amanhã. Uma empresa que falha não para as outras.
   */
  async atualizarCheckpointsDeTodos(opts: {
    prazo: number;
    /** Restringe a estas empresas (testes). */
    somente?: string[];
  }): Promise<{ empresas: number; falhas: number }> {
    const ate = new Date(Date.now() - IDADE_MINIMA_CHECKPOINT_MS);
    const filtro = opts.somente ? Prisma.sql`AND t.id = ANY(${opts.somente}::text[])` : Prisma.empty;
    const pendentes = await prisma.$queryRaw<{ id: string }[]>`
      SELECT t.id
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT MIN(c."ateCreatedAt") AS ate FROM stock_cost_checkpoints c WHERE c."tenantId" = t.id
      ) ck ON true
      WHERE EXISTS (SELECT 1 FROM stock_movements m WHERE m."tenantId" = t.id) ${filtro}
        AND (ck.ate IS NULL OR ck.ate < (${ate.toISOString()}::timestamptz AT TIME ZONE 'UTC') - interval '20 hours')
      ORDER BY ck.ate NULLS FIRST
    `;
    let empresas = 0;
    let falhas = 0;
    for (const { id } of pendentes) {
      if (Date.now() >= opts.prazo) break;
      try {
        await EstoqueService.atualizarCheckpoints(id, ate);
        empresas++;
      } catch (e) {
        falhas++;
        logger.error({ err: describeError(e), tenantId: id }, "Falha ao atualizar checkpoint de custo");
      }
    }
    return { empresas, falhas };
  },
};
