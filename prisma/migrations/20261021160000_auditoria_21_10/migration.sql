-- Correções da auditoria de 21/10 (docs/auditoria-2026-10-18.md §2c):
--  * aviso de pagamento acima do devido; conta da compra de embalagem;
--  * estorno de envio para higienização (no lugar de apagar o movimento);
--  * idempotência do recebimento de fiado.

-- AlterEnum
ALTER TYPE "AdminNotificationKind" ADD VALUE 'PAGAMENTO_ACIMA_DO_DEVIDO';

-- AlterEnum
ALTER TYPE "ExpenseOrigem" ADD VALUE 'COMPRA_EMBALAGEM';

-- AlterEnum
ALTER TYPE "PlasticCrateMovementType" ADD VALUE 'ESTORNO_SAIDA_HIGIENIZACAO';

-- AlterTable
ALTER TABLE "credit_payments" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "packagingMovementId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "credit_payments_tenantId_idempotencyKey_key" ON "credit_payments"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_packagingMovementId_key" ON "expenses"("packagingMovementId");

