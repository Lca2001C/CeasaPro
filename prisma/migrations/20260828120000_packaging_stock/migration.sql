-- Estoque de embalagens (papelão, sacaria).
--
-- Até aqui `packaging_sales` só registrava a venda: não havia saldo, então o
-- sistema deixava vender 200 sacos de um estoque de 8 sem dizer nada. O saldo
-- passa a ser DERIVADO de um livro-razão, exatamente como o de produtos em
-- `stock_movements` — nunca uma coluna mutável que pode divergir do histórico.
--
-- `tracksStock` nasce FALSE de propósito: quem já vendia embalagem nunca
-- registrou entrada, e ligar o controle para todos os tipos de uma vez faria
-- aparecer saldo negativo em tudo. Isso não seria estoque negativo, seria
-- ausência de histórico. O dono liga tipo a tipo, informando o que tem hoje.
--
-- Nenhuma tabela existente perde dado: só uma coluna com default e uma tabela nova.

-- CreateEnum
CREATE TYPE "PackagingMovementType" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'QUEBRA');

-- AlterTable
ALTER TABLE "packaging_types" ADD COLUMN "tracksStock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "packaging_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packagingTypeId" TEXT NOT NULL,
    "type" "PackagingMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,4),
    "reason" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "packaging_movements_tenantId_packagingTypeId_idx" ON "packaging_movements"("tenantId", "packagingTypeId");
CREATE INDEX "packaging_movements_tenantId_movedAt_idx" ON "packaging_movements"("tenantId", "movedAt");
CREATE INDEX "packaging_movements_sourceType_sourceId_idx" ON "packaging_movements"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "packaging_movements" ADD CONSTRAINT "packaging_movements_packagingTypeId_fkey"
  FOREIGN KEY ("packagingTypeId") REFERENCES "packaging_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "packaging_movements" ADD CONSTRAINT "packaging_movements_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
