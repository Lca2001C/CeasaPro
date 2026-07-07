import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { add, money } from "@/lib/money";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import { DEFAULT_PACKAGING_TYPES } from "@/lib/constants";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TipoEmbalagemInput, VendaEmbalagemInput } from "@/lib/validations/embalagem";
import type { TenantCtx } from "@/lib/http/with-action";

type DbClient = Pick<PrismaClient, "packagingType">;

/** Cria os tipos de embalagem padrão para um tenant (idempotente). */
export async function createDefaultPackagingTypes(
  tenantId: string,
  db: DbClient = prisma,
) {
  const data: Prisma.PackagingTypeCreateManyInput[] = DEFAULT_PACKAGING_TYPES.map(
    (name) => ({ tenantId, name }),
  );
  await db.packagingType.createMany({ data, skipDuplicates: true });
}

export const EmbalagensService = {
  async listTypes(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.packagingType.findMany({ orderBy: { name: "asc" } });
  },

  async createType(input: TipoEmbalagemInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const exists = await db.packagingType.findFirst({ where: { name: input.name } });
    if (exists) throw new BusinessRuleError("Já existe um tipo com esse nome");
    return db.packagingType.create({
      data: { tenantId: ctx.tenantId, name: input.name },
    });
  },

  async listSales(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    const vendas = await db.packagingSale.findMany({
      include: { type: true },
      orderBy: { saleDate: "desc" },
      take: 100,
    });
    const total = money(add(...vendas.map((v) => v.totalAmount)));
    const totalQtd = vendas.reduce((a, v) => a + v.quantity, 0);
    return { vendas, total, totalQtd };
  },

  async createSale(input: VendaEmbalagemInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const tipo = await db.packagingType.findFirst({ where: { id: input.packagingTypeId } });
    if (!tipo) throw new NotFoundError("Tipo de embalagem não encontrado");

    const totalAmount = FinancialCalc.valorTotalVenda(input.quantity, input.unitPrice);
    const venda = await db.packagingSale.create({
      data: {
        tenantId: ctx.tenantId,
        packagingTypeId: input.packagingTypeId,
        customerName: input.customerName || null,
        saleDate: new Date(input.saleDate),
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        totalAmount,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "PackagingSale",
      entityId: venda.id,
      newData: { tipo: tipo.name, quantity: input.quantity, totalAmount: totalAmount.toString() },
      ip: ctx.ip,
    });
    return venda;
  },

  async removeSale(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.packagingSale.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Venda não encontrada");
    await db.packagingSale.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "PackagingSale",
      entityId: id,
      oldData: before,
      ip: ctx.ip,
    });
  },
};
