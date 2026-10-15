-- CreateIndex
CREATE INDEX "stock_movements_tenantId_productId_createdAt_idx" ON "stock_movements"("tenantId", "productId", "createdAt");
