-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_sourceType_sourceId_idx" ON "stock_movements"("tenantId", "sourceType", "sourceId");
