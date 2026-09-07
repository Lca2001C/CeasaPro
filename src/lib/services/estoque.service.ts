import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { toDecimal, money } from "@/lib/money";
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
 * Custo médio PONDERADO pela quantidade — a fórmula certa.
 *
 * Era média aritmética simples (`AVG(unitCost)` / `_avg`), em três lugares. Com
 * uma compra de 100 caixas a R$ 1,00 e outra de 1 caixa a R$ 100,00, o custo
 * real é R$ 1,98 e o sistema calculava **R$ 50,50**.
 *
 * O estrago não ficava na tela: esse valor ia para `SaleItem.unitCostAtSale` e
 * dali para o CMV, o lucro bruto, o lucro do mês e a margem do painel, mais os
 * relatórios de lucro por produto, lucro por fornecedor e produtos no prejuízo.
 * Vender 1 caixa a R$ 30,00 aparecia como prejuízo de R$ 20,50 quando na
 * verdade deu lucro de R$ 28,02.
 *
 * Uma função só, usada pelos três lugares, para não voltarem a divergir.
 */
const SQL_CUSTO_MEDIO = `
  SELECT "productId",
         CASE WHEN SUM(quantity) > 0
              THEN SUM(quantity * COALESCE("unitCost", 0)) / SUM(quantity)
              ELSE 0
         END AS custo
  FROM stock_movements
  WHERE "tenantId" = $1 AND type = 'ENTRADA' AND "productId" = ANY($2::text[])
  GROUP BY "productId"
`;

/** Executor mínimo aceito — o cliente base ou um `tx` de transação. */
type CustoTxClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

/** Custo médio ponderado por produto. Chave ausente = produto sem entrada. */
export async function custoMedioPonderado(
  tx: CustoTxClient,
  tenantId: string,
  productIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx.$queryRawUnsafe<{ productId: string; custo: Prisma.Decimal | string }[]>(
    SQL_CUSTO_MEDIO,
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
    const rows = await prisma.$queryRaw<
      {
        productId: string;
        name: string;
        saleUnit: string;
        quantity: Prisma.Decimal | string;
        value: Prisma.Decimal | string;
        avgcost: Prisma.Decimal | string;
        lastmovementat: Date | null;
      }[]
    >`
      SELECT p.id AS "productId",
             p.name AS name,
             p."saleUnit"::text AS "saleUnit",
             COALESCE(SUM(CASE WHEN m.type IN ('ENTRADA','AJUSTE') THEN m.quantity ELSE -m.quantity END), 0) AS quantity,
             COALESCE(SUM(CASE WHEN m.type IN ('ENTRADA','AJUSTE') THEN m.quantity ELSE -m.quantity END * COALESCE(m."unitCost", 0)), 0) AS value,
             CASE WHEN COALESCE(SUM(CASE WHEN m.type = 'ENTRADA' THEN m.quantity END), 0) > 0
                  THEN SUM(CASE WHEN m.type = 'ENTRADA' THEN m.quantity * COALESCE(m."unitCost", 0) END)
                       / SUM(CASE WHEN m.type = 'ENTRADA' THEN m.quantity END)
                  ELSE 0
             END AS avgcost,
             MAX(m."movedAt") AS lastmovementat
      FROM products p
      LEFT JOIN stock_movements m ON m."productId" = p.id AND m."tenantId" = ${tenantId}
      WHERE p."tenantId" = ${tenantId} AND p."deletedAt" IS NULL
      GROUP BY p.id, p.name, p."saleUnit"
      ORDER BY p.name ASC
    `;
    return rows.map((r) => ({
      productId: r.productId,
      name: r.name,
      saleUnit: r.saleUnit,
      quantity: toDecimal(r.quantity as Prisma.Decimal.Value),
      avgCost: money(toDecimal(r.avgcost as Prisma.Decimal.Value)),
      value: money(toDecimal(r.value as Prisma.Decimal.Value)),
      lastMovementAt: r.lastmovementat,
    }));
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
   */
  async getTotalValue(tenantId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.$queryRaw<{ value: Prisma.Decimal | string }[]>`
      SELECT COALESCE(SUM(CASE WHEN m.type IN ('ENTRADA','AJUSTE') THEN m.quantity ELSE -m.quantity END * COALESCE(m."unitCost", 0)), 0) AS value
      FROM stock_movements m
      JOIN products p ON p.id = m."productId"
      WHERE m."tenantId" = ${tenantId} AND p."deletedAt" IS NULL
    `;
    return money(toDecimal((rows[0]?.value ?? 0) as Prisma.Decimal.Value));
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

      // Custo unitário: informado, senão o custo médio PONDERADO das entradas.
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
