-- Ponto de partida do repasse do custo médio (ver `StockCostCheckpoint` no schema).
-- Tabela derivada: vazia, o custo continua o mesmo, só mais caro de calcular.

-- CreateTable
CREATE TABLE "stock_cost_checkpoints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ateCreatedAt" TIMESTAMP(3) NOT NULL,
    "saldo" DECIMAL(14,3) NOT NULL,
    "custo" DECIMAL(40,20),
    "ultimoCustoEntrada" DECIMAL(14,4),
    "ultimoMovedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_cost_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_cost_checkpoints_tenantId_productId_key" ON "stock_cost_checkpoints"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_createdAt_idx" ON "stock_movements"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "stock_cost_checkpoints" ADD CONSTRAINT "stock_cost_checkpoints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_cost_checkpoints" ADD CONSTRAINT "stock_cost_checkpoints_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
