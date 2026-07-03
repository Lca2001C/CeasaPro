import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { NotFoundError } from "@/lib/http/app-error";
import type { FornecedorInput, FornecedorUpdateInput } from "@/lib/validations/fornecedor";
import type { TenantCtx } from "@/lib/http/with-action";

export const FornecedoresService = {
  async list(tenantId: string, search?: string) {
    const db = getTenantPrisma(tenantId);
    return db.supplier.findMany({
      where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const s = await db.supplier.findFirst({ where: { id } });
    if (!s) throw new NotFoundError("Fornecedor não encontrado");
    return s;
  },

  /** Histórico de compras do fornecedor. */
  async purchaseHistory(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    return db.purchase.findMany({
      where: { supplierId: id },
      orderBy: { purchaseDate: "desc" },
      take: 50,
    });
  },

  async create(input: FornecedorInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const s = await db.supplier.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        active: input.active,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "Supplier",
      entityId: s.id,
      newData: s,
      ip: ctx.ip,
    });
    return s;
  },

  async update(input: FornecedorUpdateInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.supplier.findFirst({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Fornecedor não encontrado");
    const s = await db.supplier.update({
      where: { id: input.id },
      data: {
        name: input.name,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        active: input.active,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Supplier",
      entityId: s.id,
      oldData: before,
      newData: s,
      ip: ctx.ip,
    });
    return s;
  },

  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.supplier.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Fornecedor não encontrado");
    await db.supplier.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "Supplier",
      entityId: id,
      oldData: before,
      ip: ctx.ip,
    });
  },
};
