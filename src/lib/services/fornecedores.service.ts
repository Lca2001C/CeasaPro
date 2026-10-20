import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { formatBRL } from "@/lib/format";
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

  /**
   * Histórico de compras do fornecedor, com a conta (paga ou a pagar) de cada
   * uma. A compra cancelada fica de fora: não é negócio feito com ele (ela
   * continua, marcada, na lista de compras do Estoque).
   */
  async purchaseHistory(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    return db.purchase.findMany({
      where: { supplierId: id, cancelledAt: null },
      include: {
        expenses: {
          where: { origem: "COMPRA", deletedAt: null },
          select: { id: true, status: true, dueDate: true },
          take: 1,
        },
      },
      orderBy: { purchaseDate: "desc" },
      take: 50,
    });
  },

  /**
   * Quanto a empresa ainda deve a este fornecedor: as contas PENDENTES ligadas
   * a ele (as de compra e as lançadas à mão com o fornecedor).
   */
  async emAberto(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const r = await db.expense.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: { supplierId: id, status: "PENDENTE" },
    });
    return { total: r._sum.amount ?? 0, contas: r._count._all };
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

  /**
   * Exclui (soft delete) o fornecedor — só sem conta a pagar para ele.
   *
   * Com conta pendente, a dívida continuava em Contas a Pagar e o nome de a
   * quem ela é devida sumia da leitura. Pague (ou cancele a compra, no prazo)
   * antes; para só tirá-lo das telas de compra, desative-o.
   *
   * A linha do fornecedor é travada: a compra trava a mesma linha
   * (`FOR SHARE`) ao gravar, então uma compra em andamento termina antes desta
   * conferência — e a que vier depois já o encontra excluído.
   */
  async remove(id: string, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    await db.$transaction(async (tx) => {
      const travado = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM suppliers
        WHERE "tenantId" = ${ctx.tenantId} AND id = ${id} AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (travado.length === 0) throw new NotFoundError("Fornecedor não encontrado");

      const pendentes = await tx.expense.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { supplierId: id, status: "PENDENTE" },
      });
      if (pendentes._count._all > 0) {
        throw new BusinessRuleError(
          `Há ${pendentes._count._all} conta(s) a pagar para este fornecedor ` +
            `(${formatBRL(pendentes._sum.amount ?? 0)}). Pague-as antes de excluir — sem o ` +
            "fornecedor, a dívida ficaria sem nome. Para só tirá-lo das compras, desative-o.",
        );
      }

      const before = await tx.supplier.findFirst({ where: { id } });
      await tx.supplier.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "DELETE",
          entity: "Supplier",
          entityId: id,
          oldData: before,
          ip: ctx.ip,
        },
        tx,
      );
    });
  },
};
