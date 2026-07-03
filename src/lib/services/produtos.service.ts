import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { NotFoundError } from "@/lib/http/app-error";
import type { ProdutoInput, ProdutoUpdateInput } from "@/lib/validations/produto";
import type { TenantCtx } from "@/lib/http/with-action";

export const ProdutosService = {
  async list(tenantId: string, search?: string) {
    const db = getTenantPrisma(tenantId);
    return db.product.findMany({
      where: search
        ? { name: { contains: search, mode: "insensitive" } }
        : undefined,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const product = await db.product.findFirst({ where: { id } });
    if (!product) throw new NotFoundError("Produto não encontrado");
    return product;
  },

  async create(input: ProdutoInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const product = await db.product.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        saleUnit: input.saleUnit,
        qtyPerRecipient: input.qtyPerRecipient ?? null,
        recipientType: input.recipientType ?? null,
        sackCapacity: input.sackCapacity ?? null,
        active: input.active,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "Product",
      entityId: product.id,
      newData: product,
      ip: ctx.ip,
    });
    return product;
  },

  async update(input: ProdutoUpdateInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.product.findFirst({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Produto não encontrado");
    const product = await db.product.update({
      where: { id: input.id },
      data: {
        name: input.name,
        saleUnit: input.saleUnit,
        qtyPerRecipient: input.qtyPerRecipient ?? null,
        recipientType: input.recipientType ?? null,
        sackCapacity: input.sackCapacity ?? null,
        active: input.active,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Product",
      entityId: product.id,
      oldData: before,
      newData: product,
      ip: ctx.ip,
    });
    return product;
  },

  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.product.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Produto não encontrado");
    await db.product.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "Product",
      entityId: id,
      oldData: before,
      ip: ctx.ip,
    });
  },
};
