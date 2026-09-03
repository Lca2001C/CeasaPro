-- PDV: pagamento misto, desconto, troco, telefone e cancelamento de venda.
--
-- Tudo aditivo. `totalAmount` continua sendo o valor cobrado (é o que todo o
-- resto do sistema consome) e `Sale.paymentMethod` continua existindo com o
-- mesmo significado — numa venda mista ele guarda a forma predominante, e o
-- detalhe vai para `sale_payments`.
--
-- `ESTORNO_SAIDA` não é usado nesta migração (seguro em transação no PG 12+).

-- AlterEnum
ALTER TYPE "PlasticCrateMovementType" ADD VALUE 'ESTORNO_SAIDA';

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "amountReceived" DECIMAL(14,2),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "changeGiven" DECIMAL(14,2),
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "subtotalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_payments_tenantId_saleId_idx" ON "sale_payments"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "sale_payments_saleId_idx" ON "sale_payments"("saleId");

-- CreateIndex
CREATE INDEX "sales_tenantId_cancelledAt_idx" ON "sales"("tenantId", "cancelledAt");

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: para as vendas que já existem não houve desconto, então o bruto é
-- igual ao cobrado. Sem isto o subtotal ficaria em zero e o relatório mostraria
-- "100% de desconto" no histórico inteiro.
UPDATE "sales" SET "subtotalAmount" = "totalAmount" WHERE "subtotalAmount" = 0;
