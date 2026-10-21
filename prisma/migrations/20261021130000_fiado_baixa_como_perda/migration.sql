-- Fiado que não vai ser pago: "Baixar como perda" (FiadoService.baixarComoPerda).
ALTER TYPE "CreditStatus" ADD VALUE 'PERDA';

ALTER TABLE "credit_accounts" ADD COLUMN "writtenOffAt" TIMESTAMP(3),
ADD COLUMN "writtenOffAmount" DECIMAL(14,2),
ADD COLUMN "writtenOffReason" TEXT;

CREATE INDEX "credit_accounts_tenantId_writtenOffAt_idx" ON "credit_accounts"("tenantId", "writtenOffAt");
