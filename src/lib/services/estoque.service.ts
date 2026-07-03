import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { toDecimal, money } from "@/lib/money";
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
             COALESCE(AVG(CASE WHEN m.type = 'ENTRADA' THEN m."unitCost" END), 0) AS avgcost,
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

  /** Valor total em estoque (para o dashboard). */
  async getTotalValue(tenantId: string): Promise<Prisma.Decimal> {
    const rows = await prisma.$queryRaw<{ value: Prisma.Decimal | string }[]>`
      SELECT COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END * COALESCE("unitCost", 0)), 0) AS value
      FROM stock_movements
      WHERE "tenantId" = ${tenantId}
    `;
    return money(toDecimal((rows[0]?.value ?? 0) as Prisma.Decimal.Value));
  },

  /** Ajuste manual de estoque: quebra/perda, doação ou acerto. */
  async registrarAjuste(input: AjusteEstoqueInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    return db.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: input.productId } });
      if (!product) throw new Error("Produto não encontrado");

      // Custo unitário: informado, senão custo médio das entradas.
      const avg = await tx.stockMovement.aggregate({
        _avg: { unitCost: true },
        where: { productId: input.productId, type: "ENTRADA" },
      });
      const unitCost = input.unitCost ?? avg._avg.unitCost ?? new Prisma.Decimal(0);

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
