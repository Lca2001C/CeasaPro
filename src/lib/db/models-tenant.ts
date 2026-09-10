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
  "CrateCleaningPayment",
  "PackagingType",
  "PackagingSale",
  // Tinha `tenantId` e era consultado via `getTenantPrisma`, mas estava fora
  // desta lista: a extensão não injetava filtro nenhum. Hoje todas as chamadas
  // passam o tenantId à mão, então nada vazava — mas a primeira que esquecesse
  // cruzaria empresas em silêncio.
  "PackagingMovement",
  // Cotações. Três modelos do módulo têm `tenantId`; as tabelas de central,
  // produto do boletim e cotação são globais de propósito (o preço da central é
  // o mesmo para todo mundo), e por não terem a coluna nem chegam a este teste.
  // O vínculo, não: ele é a decisão de UMA empresa sobre o produto DELA.
  "TenantCeasaLink",
  // O alerta de flutuação, pela mesma razão do vínculo: preço é público, mas
  // "me avise se subir 10%" é decisão de uma empresa só.
  "TenantCeasaAlerta",
  // O boletim que o cliente ENVIOU e ainda não foi publicado. É rascunho dele:
  // enquanto está na fila, nenhum outro cliente da mesma praça pode ver — e é
  // justamente essa invisibilidade que permite ao envio existir sem um tenant
  // escrever na tabela global de cotações.
  "TenantBoletimEnviado",
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
