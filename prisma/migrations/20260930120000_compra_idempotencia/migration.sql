-- Idempotência da compra: o reenvio do formulário (toque duplo, retentativa
-- depois de timeout) devolve a compra já gravada em vez de dar entrada no
-- estoque de novo. Coluna nula nas compras antigas; vários NULL não colidem.

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "purchases_tenantId_idempotencyKey_key" ON "purchases"("tenantId", "idempotencyKey");
