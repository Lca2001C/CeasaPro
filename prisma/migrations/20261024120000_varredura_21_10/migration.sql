-- Varredura de 21/10: senha comprovada, idempotência de ajuste/embalagem/higienização
-- e deslocamento do checkpoint do custo médio.

-- AlterTable
ALTER TABLE "crate_cleanings" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "packaging_movements" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "packaging_sales" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "stock_cost_checkpoints" ADD COLUMN     "deslocamento" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "senhaComprovada" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "crate_cleanings_tenantId_idempotencyKey_key" ON "crate_cleanings"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_movements_tenantId_idempotencyKey_key" ON "packaging_movements"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_sales_tenantId_idempotencyKey_key" ON "packaging_sales"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_tenantId_idempotencyKey_key" ON "stock_movements"("tenantId", "idempotencyKey");


-- Os checkpoints gravados antes do deslocamento erravam o custo de um ciclo que
-- recomeçou num saldo negativo. A tabela é derivada: apagar só deixa a próxima
-- conta mais cara, e o cron (ou scripts/recalcular-checkpoints.ts) refaz.
DELETE FROM "stock_cost_checkpoints";
