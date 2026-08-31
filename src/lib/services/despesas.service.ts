import type { ExpenseStatus } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { audit } from "@/lib/audit";
import { FinancialCalc } from "./financial-calc.service";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";

/**
 * Quantas despesas cada página da tela carrega.
 *
 * 100 cabe em uma rolagem confortável no celular e mantém a resposta abaixo de
 * poucas dezenas de milissegundos mesmo com anos de histórico.
 */
export const DESPESAS_POR_PAGINA = 100;
import type {
  DespesaInput,
  DespesaUpdateInput,
  CategoriaInput,
} from "@/lib/validations/despesa";
import type { TenantCtx } from "@/lib/http/with-action";

function toDate(v?: string | null): Date | null {
  return v ? new Date(v) : null;
}

async function assertCategory(db: ReturnType<typeof getTenantPrisma>, categoryId?: string | null) {
  if (!categoryId) return null;
  const category = await db.expenseCategory.findFirst({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) throw new NotFoundError("Categoria nao encontrada");
  return category.id;
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

  /**
   * Uma página da listagem de despesas.
   *
   * Antes esta função devolvia TODAS as despesas da empresa, e a tela filtrava,
   * ordenava e somava em JavaScript. Medido com 2 anos de operação (8.000
   * despesas) isso levava ~278 ms no servidor, e o custo cresce linearmente: em
   * 4 anos passa de meio segundo, mais o peso de serializar tudo para o celular
   * do cliente. Filtro, ordem e limite agora são do banco.
   */
  async list(
    tenantId: string,
    opts: { status?: ExpenseStatus; take?: number; skip?: number } = {},
  ) {
    const db = getTenantPrisma(tenantId);
    return db.expense.findMany({
      where: opts.status ? { status: opts.status } : {},
      include: { category: true },
      // A ordem reproduz o que a tela fazia em JS: o que vence primeiro no topo,
      // e sem vencimento no fim (não há prazo correndo). Para as já pagas, o
      // mais recente primeiro — ali a ordem de vencimento não diz nada.
      orderBy:
        opts.status === "PAGO"
          ? [{ dueDate: "desc" }, { createdAt: "desc" }]
          : [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: opts.take ?? DESPESAS_POR_PAGINA,
      skip: opts.skip ?? 0,
    });
  },

  /** Quantas despesas existem no filtro atual (para a paginação). */
  async count(tenantId: string, opts: { status?: ExpenseStatus } = {}) {
    const db = getTenantPrisma(tenantId);
    return db.expense.count({ where: opts.status ? { status: opts.status } : {} });
  },

  /**
   * Totais por tipo, somados NO BANCO.
   *
   * Somam SEMPRE todas as despesas, não só a página nem o filtro: os cards são o
   * retrato do quanto se deve no total, e filtrar a lista não pode mudar isso.
   * O `groupBy` devolve uma linha por tipo, então a fórmula continua em
   * `FinancialCalc` — só deixou de receber 8.000 linhas para receber duas.
   */
  async totais(tenantId: string) {
    const db = getTenantPrisma(tenantId);
    const porTipo = await db.expense.groupBy({
      by: ["type"],
      _sum: { amount: true },
    });
    return FinancialCalc.totaisDespesas(
      porTipo.map((g) => ({ type: g.type, amount: g._sum.amount ?? 0 })),
    );
  },

  async get(tenantId: string, id: string) {
    const db = getTenantPrisma(tenantId);
    const e = await db.expense.findFirst({ where: { id } });
    if (!e) throw new NotFoundError("Despesa não encontrada");
    return e;
  },

  async create(input: DespesaInput, ctx: TenantCtx) {
    const db = getTenantPrisma(ctx.tenantId);
    const categoryId = await assertCategory(db, input.categoryId);
    const e = await db.expense.create({
      data: {
        tenantId: ctx.tenantId,
        description: input.description,
        amount: input.amount,
        type: input.type,
        status: input.status,
        categoryId,
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
    const categoryId = await assertCategory(db, input.categoryId);
    const e = await db.expense.update({
      where: { id: input.id },
      data: {
        description: input.description,
        amount: input.amount,
        type: input.type,
        status: input.status,
        categoryId,
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
