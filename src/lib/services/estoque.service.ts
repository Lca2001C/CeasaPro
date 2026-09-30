import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { toDecimal, money, add } from "@/lib/money";
import { FinancialCalc } from "./financial-calc.service";
import { passaDoEstoque } from "@/lib/estoque/nivel";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import type { AjusteEstoqueInput } from "@/lib/validations/estoque";
import type { TenantCtx } from "@/lib/http/with-action";

export interface StockPosition {
  productId: string;
  name: string;
  saleUnit: string;
  quantity: Prisma.Decimal;
  avgCost: Prisma.Decimal;
  value: Prisma.Decimal;
  lastMovementAt: Date | null;
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
 */
function sqlCustoEstoque(filtrarProdutos: boolean): string {
  return `
  WITH mov AS (
    SELECT "productId", "movedAt",
           CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END AS q,
           "unitCost" AS c,
           ROW_NUMBER() OVER w AS seq,
           SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END) OVER w AS saldo
    FROM stock_movements
    WHERE "tenantId" = $1${filtrarProdutos ? ` AND "productId" = ANY($2::text[])` : ""}
    WINDOW w AS (PARTITION BY "productId" ORDER BY "createdAt", id)
  ),
  marcado AS (
    SELECT mov.*,
           MAX(CASE WHEN saldo <= 0 THEN seq END) OVER (PARTITION BY "productId") AS zerou_em
    FROM mov
  ),
  ciclo AS (
    SELECT "productId", seq, q, c,
           SUM(q) OVER (PARTITION BY "productId" ORDER BY seq) AS sc,
           SUM(q) OVER (PARTITION BY "productId") AS q_ciclo
    FROM marcado
    WHERE seq > COALESCE(zerou_em, 0)
  ),
  entradas AS (
    SELECT "productId", seq, q, c, sc, q_ciclo,
           COALESCE(LEAD(sc - q) OVER (PARTITION BY "productId" ORDER BY seq), q_ciclo) AS antes_da_proxima
    FROM ciclo
    WHERE q > 0
  ),
  pesos AS (
    SELECT "productId", q, c, q_ciclo,
           SUM(CASE WHEN antes_da_proxima = sc THEN 0 ELSE LN(antes_da_proxima / sc) END)
             OVER (PARTITION BY "productId" ORDER BY seq DESC) AS ln_peso
    FROM entradas
  ),
  medio AS (
    SELECT "productId",
           SUM(q * COALESCE(c, 0) * CASE WHEN ln_peso < -40 THEN 0 ELSE EXP(ln_peso) END)
             / MAX(q_ciclo) AS custo
    FROM pesos
    GROUP BY "productId"
  ),
  ultima AS (
    SELECT DISTINCT ON ("productId") "productId", COALESCE(c, 0) AS custo
    FROM mov
    WHERE q > 0
    ORDER BY "productId", seq DESC
  ),
  saldo AS (
    SELECT "productId", SUM(q) AS quantidade, MAX("movedAt") AS ultimo_mov
    FROM mov
    GROUP BY "productId"
  ),
  resultado AS (
    SELECT s."productId", s.quantidade, s.ultimo_mov,
           ROUND(CASE WHEN s.quantidade > 0 THEN m.custo ELSE u.custo END, 4) AS custo
    FROM saldo s
    LEFT JOIN medio m ON m."productId" = s."productId"
    LEFT JOIN ultima u ON u."productId" = s."productId"
  )`;
}

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

/** O movimento TIRA do estoque? (`AJUSTE` negativo é acerto de inventário para baixo.) */
function retiraDoEstoque(input: AjusteEstoqueInput): boolean {
  if (input.type === "QUEBRA" || input.type === "DOACAO") return true;
  return input.type === "AJUSTE" && input.quantity < 0;
}

/** Saldo do produto lido DENTRO da transação, depois do lock. */
async function saldoNaTransacao(
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
      }[]
    >(
      `${sqlCustoEstoque(false)}
       SELECT p.id AS "productId",
              p.name AS name,
              p."saleUnit"::text AS "saleUnit",
              COALESCE(r.quantidade, 0) AS quantity,
              COALESCE(r.custo, 0) AS custo,
              r.ultimo_mov AS lastmovementat
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
   * Pelo mesmo motivo é a SOMA das linhas de `getPositions`, e não uma conta
   * própria: `Σ(qtde com sinal × unitCost)` do livro-razão deixava valor
   * residual em produto de saldo zero (R$ 3.500 no exemplo de
   * {@link sqlCustoEstoque}), que a tela escondia e o painel mostrava.
   */
  async getTotalValue(tenantId: string): Promise<Prisma.Decimal> {
    const posicoes = await EstoqueService.getPositions(tenantId);
    return money(add(...posicoes.map((p) => p.value)));
  },

  /** Ajuste manual de estoque: quebra/perda, doação ou acerto. */
  async registrarAjuste(input: AjusteEstoqueInput, ctx: TenantCtx) {
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

      // Custo unitário: informado, senão o custo médio móvel do estoque atual
      // (sem saldo, o da última entrada — ver `sqlCustoEstoque`).
      const custos = await custoMedioPonderado(tx, ctx.tenantId, [input.productId]);
      const unitCost =
        input.unitCost != null
          ? toDecimal(input.unitCost)
          : (custos.get(input.productId) ?? new Prisma.Decimal(0));

      const movement = await tx.stockMovement.create({
        data: {
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: input.type,
          quantity: input.quantity,
          unitCost,
          reason: input.reason ?? null,
          sourceType: "MANUAL",
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
};
