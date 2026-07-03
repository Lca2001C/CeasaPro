import { prisma } from "@/lib/db/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/constants";

export { DEFAULT_EXPENSE_CATEGORIES };

type DbClient = Pick<PrismaClient, "expenseCategory">;

/** Cria as categorias padrão para um tenant (idempotente via skipDuplicates). */
export async function createDefaultExpenseCategories(
  tenantId: string,
  db: DbClient = prisma,
) {
  const data: Prisma.ExpenseCategoryCreateManyInput[] = DEFAULT_EXPENSE_CATEGORIES.map(
    (name) => ({ tenantId, name, isDefault: true }),
  );
  await db.expenseCategory.createMany({ data, skipDuplicates: true });
}
