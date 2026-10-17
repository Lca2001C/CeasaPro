-- DropIndex
DROP INDEX "credit_accounts_tenantId_status_idx";

-- DropIndex
DROP INDEX "sale_payments_tenantId_saleId_idx";

-- DropIndex
DROP INDEX "stock_movements_tenantId_productId_createdAt_idx";

-- DropIndex
DROP INDEX "users_tenantId_idx";

-- CreateIndex
CREATE INDEX "credit_accounts_tenantId_status_dueDate_idx" ON "credit_accounts"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "credit_accounts_tenantId_status_createdAt_idx" ON "credit_accounts"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_productId_createdAt_id_idx" ON "stock_movements"("tenantId", "productId", "createdAt", "id");
