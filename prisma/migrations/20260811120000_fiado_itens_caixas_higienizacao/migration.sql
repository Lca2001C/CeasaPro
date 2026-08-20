-- Fiado com itens/caixas + higienização integrada ao estoque de caixas.
-- Tudo aditivo e com DEFAULT: nenhuma linha existente muda de comportamento.
-- Os valores novos do enum não são usados nesta migração (seguro em transação no PG 12+).

-- AlterEnum
ALTER TYPE "PlasticCrateMovementType" ADD VALUE 'SAIDA_HIGIENIZACAO';
ALTER TYPE "PlasticCrateMovementType" ADD VALUE 'RETORNO_HIGIENIZACAO';

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "plasticCrateQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "crateQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "credit_accounts" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "plastic_crate_movements" ADD COLUMN     "cleanerName" TEXT,
ADD COLUMN     "crateCleaningId" TEXT,
ADD COLUMN     "dirty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "saleId" TEXT;

-- CreateIndex
CREATE INDEX "plastic_crate_movements_tenantId_customerName_idx" ON "plastic_crate_movements"("tenantId", "customerName");

-- CreateIndex
CREATE INDEX "plastic_crate_movements_saleId_idx" ON "plastic_crate_movements"("saleId");

-- CreateIndex
CREATE INDEX "plastic_crate_movements_crateCleaningId_idx" ON "plastic_crate_movements"("crateCleaningId");

-- AddForeignKey
ALTER TABLE "plastic_crate_movements" ADD CONSTRAINT "plastic_crate_movements_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plastic_crate_movements" ADD CONSTRAINT "plastic_crate_movements_crateCleaningId_fkey" FOREIGN KEY ("crateCleaningId") REFERENCES "crate_cleanings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
