-- Despesas: forma de pagamento, recorrência mensal e vínculo com o frete da compra.
--
-- Tudo aditivo e com DEFAULT/NULL: nenhuma despesa existente muda de
-- comportamento. `recurring` nasce false (nada passa a se repetir sozinho) e
-- `paymentMethod` fica nulo (a conta continua válida sem informar por onde saiu).
--
-- Os valores novos de enum não são usados nesta migração — seguro em transação
-- no PostgreSQL 12+.

-- CreateEnum
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('PIX', 'DINHEIRO', 'TRANSFERENCIA', 'BOLETO', 'CARTAO');

-- AlterEnum
ALTER TYPE "ReportType" ADD VALUE 'CONTAS_PAGAS';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "paymentMethod" "ExpensePaymentMethod",
ADD COLUMN     "purchaseId" TEXT,
ADD COLUMN     "recurring" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "expenses_tenantId_paidDate_idx" ON "expenses"("tenantId", "paidDate");

-- CreateIndex
CREATE INDEX "expenses_tenantId_recurring_idx" ON "expenses"("tenantId", "recurring");

-- CreateIndex
CREATE INDEX "expenses_purchaseId_idx" ON "expenses"("purchaseId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
