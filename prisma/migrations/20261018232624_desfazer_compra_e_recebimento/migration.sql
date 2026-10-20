-- AlterTable
ALTER TABLE "credit_payments" ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedReason" TEXT;

-- AlterTable
ALTER TABLE "plastic_crate_movements" ADD COLUMN     "purchaseId" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledReason" TEXT;

-- CreateIndex
CREATE INDEX "plastic_crate_movements_purchaseId_idx" ON "plastic_crate_movements"("purchaseId");

-- AddForeignKey
ALTER TABLE "plastic_crate_movements" ADD CONSTRAINT "plastic_crate_movements_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
