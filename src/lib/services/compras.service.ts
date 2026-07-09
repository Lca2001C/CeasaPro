import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { add, mul, money } from "@/lib/money";
import { NotFoundError } from "@/lib/http/app-error";
import type { CompraInput } from "@/lib/validations/compra";
import type { TenantCtx } from "@/lib/http/with-action";

export const ComprasService = {
  async list(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.purchase.findMany({
      include: { supplier: true, items: true },
      orderBy: { purchaseDate: "desc" },
      take: 100,
    });
  },

  async registrarCompra(input: CompraInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const productIds = [...new Set(input.items.map((i) => i.productId))];

    const lineTotals = input.items.map((i) => mul(i.quantity, i.unitPrice));
    const freightShares = FinancialCalc.ratearFrete(lineTotals, input.freight);
    const totalAmount = money(add(...lineTotals, input.freight));

    const itemsData = input.items.map((i, idx) => ({
      tenantId: ctx.tenantId,
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      recipientType: i.recipientType ?? null,
      freightShare: freightShares[idx],
      unitCost: FinancialCalc.custoRealUnitario(i.quantity, i.unitPrice, freightShares[idx]),
      lineTotal: money(lineTotals[idx]),
      suggestedSalePrice: i.suggestedSalePrice ?? null,
    }));

    return db.$transaction(async (tx) => {
      if (input.supplierId) {
        const supplier = await tx.supplier.findFirst({
          where: { id: input.supplierId, active: true },
          select: { id: true },
        });
        if (!supplier) throw new NotFoundError("Fornecedor nao encontrado");
      }

      const products = await tx.product.findMany({
        where: { id: { in: productIds }, active: true },
        select: { id: true },
      });
      if (products.length !== productIds.length) {
        throw new NotFoundError("Um ou mais produtos nao foram encontrados");
      }

      const purchase = await tx.purchase.create({
        data: {
          tenantId: ctx.tenantId,
          supplierId: input.supplierId || null,
          purchaseDate: new Date(input.purchaseDate),
          freight: input.freight,
          totalAmount,
          notes: input.notes ?? null,
          items: { create: itemsData },
        },
        include: { items: true },
      });

      await tx.stockMovement.createMany({
        data: purchase.items.map((it) => ({
          tenantId: ctx.tenantId,
          productId: it.productId,
          type: "ENTRADA" as const,
          quantity: it.quantity,
          unitCost: it.unitCost,
          sourceType: "PURCHASE",
          sourceId: purchase.id,
          movedAt: purchase.purchaseDate,
        })),
      });

      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "Purchase",
          entityId: purchase.id,
          newData: { totalAmount: totalAmount.toString(), items: purchase.items.length },
          ip: ctx.ip,
        },
        tx,
      );

      return purchase;
    });
  },
};
