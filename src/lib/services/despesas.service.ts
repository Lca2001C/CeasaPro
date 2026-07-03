import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import type {
  DespesaInput,
  DespesaUpdateInput,
  CategoriaInput,
} from "@/lib/validations/despesa";
import type { TenantCtx } from "@/lib/http/with-action";

function toDate(v?: string | null): Date | null {
  return v ? new Date(v) : null;
}

export const DespesasService = {
  async listCategories(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.expenseCategory.findMany({ orderBy: { name: "asc" } });
  },

  async createCategory(input: CategoriaInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const exists = await db.expenseCategory.findFirst({ where: { name: input.name } });
    if (exists) throw new BusinessRuleError("Já existe uma categoria com esse nome");
    return db.expenseCategory.create({
      data: { tenantId: ctx.tenantId, name: input.name },
    });
  },

  async list(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    return db.expense.findMany({
      include: { category: true },
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
    });
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const e = await db.expense.findFirst({ where: { id } });
    if (!e) throw new NotFoundError("Despesa não encontrada");
    return e;
  },

  async create(input: DespesaInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const e = await db.expense.create({
      data: {
        tenantId: ctx.tenantId,
        description: input.description,
        amount: input.amount,
        type: input.type,
        status: input.status,
        categoryId: input.categoryId || null,
        dueDate: toDate(input.dueDate),
        paidDate: toDate(input.paidDate),
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "Expense",
      entityId: e.id,
      newData: e,
      ip: ctx.ip,
    });
    return e;
  },

  async update(input: DespesaUpdateInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.expense.findFirst({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Despesa não encontrada");
    const e = await db.expense.update({
      where: { id: input.id },
      data: {
        description: input.description,
        amount: input.amount,
        type: input.type,
        status: input.status,
        categoryId: input.categoryId || null,
        dueDate: toDate(input.dueDate),
        paidDate: toDate(input.paidDate),
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Expense",
      entityId: e.id,
      oldData: before,
      newData: e,
      ip: ctx.ip,
    });
    return e;
  },

  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const before = await db.expense.findFirst({ where: { id } });
    if (!before) throw new NotFoundError("Despesa não encontrada");
    await db.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "Expense",
      entityId: id,
      oldData: before,
      ip: ctx.ip,
    });
  },
};
