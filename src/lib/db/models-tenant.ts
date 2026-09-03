/**
 * Fonte da verdade de quais models são isolados por tenant.
 * TENANT_MODELS: possuem coluna `tenantId` → a extensão injeta o filtro/dado.
 * SOFT_DELETE_MODELS: subconjunto que também possui `deletedAt` → leitura filtra `deletedAt: null`.
 * (Nomes exatamente como no schema.prisma — PascalCase.)
 */
export const TENANT_MODELS = new Set<string>([
  "Product",
  "Supplier",
  "Purchase",
  "PurchaseItem",
  "Sale",
  "SaleItem",
  "SalePayment",
  "CreditAccount",
  "CreditPayment",
  "StockMovement",
  "Expense",
  "ExpenseCategory",
  "ReportExport",
  // Fase 2
  "PlasticCrateMovement",
  "CrateCleaning",
  "PackagingType",
  "PackagingSale",
  // Tinha `tenantId` e era consultado via `getTenantPrisma`, mas estava fora
  // desta lista: a extensão não injetava filtro nenhum. Hoje todas as chamadas
  // passam o tenantId à mão, então nada vazava — mas a primeira que esquecesse
  // cruzaria empresas em silêncio.
  "PackagingMovement",
]);

export const SOFT_DELETE_MODELS = new Set<string>([
  "Product",
  "Supplier",
  "Purchase",
  "Sale",
  "CreditAccount",
  "Expense",
  "ExpenseCategory",
  // Fase 2
  "CrateCleaning",
  "PackagingType",
  "PackagingSale",
]);

const READ_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

const WHERE_WRITE_OPS = new Set([
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

export function isReadOp(op: string) {
  return READ_OPS.has(op);
}

export function isWhereWriteOp(op: string) {
  return WHERE_WRITE_OPS.has(op);
}
