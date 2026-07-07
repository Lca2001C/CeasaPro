-- CreateEnum
CREATE TYPE "PlasticCrateMovementType" AS ENUM ('ENTRADA', 'SAIDA', 'RETORNO', 'QUEBRA');

-- CreateEnum
CREATE TYPE "CrateCleaningStatus" AS ENUM ('ENVIADO', 'DEVOLVIDO', 'PAGO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportType" ADD VALUE 'LUCRO_PRODUTO';
ALTER TYPE "ReportType" ADD VALUE 'MAIS_VENDIDOS';
ALTER TYPE "ReportType" ADD VALUE 'CAIXAS_PLASTICAS';
ALTER TYPE "ReportType" ADD VALUE 'HIGIENIZACAO';
ALTER TYPE "ReportType" ADD VALUE 'EMBALAGENS';

-- CreateTable
CREATE TABLE "plastic_crate_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "PlasticCrateMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "brokenQty" INTEGER NOT NULL DEFAULT 0,
    "customerName" TEXT,
    "supplierName" TEXT,
    "movementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plastic_crate_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crate_cleanings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cleanerName" TEXT NOT NULL,
    "sentDate" TIMESTAMP(3) NOT NULL,
    "sentQty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "returnedDate" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidDate" TIMESTAMP(3),
    "status" "CrateCleaningStatus" NOT NULL DEFAULT 'ENVIADO',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crate_cleanings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "packaging_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packagingTypeId" TEXT NOT NULL,
    "customerName" TEXT,
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "packaging_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plastic_crate_movements_tenantId_movementDate_idx" ON "plastic_crate_movements"("tenantId", "movementDate");

-- CreateIndex
CREATE INDEX "plastic_crate_movements_tenantId_type_idx" ON "plastic_crate_movements"("tenantId", "type");

-- CreateIndex
CREATE INDEX "crate_cleanings_tenantId_sentDate_idx" ON "crate_cleanings"("tenantId", "sentDate");

-- CreateIndex
CREATE INDEX "crate_cleanings_tenantId_status_idx" ON "crate_cleanings"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_types_tenantId_name_key" ON "packaging_types"("tenantId", "name");

-- CreateIndex
CREATE INDEX "packaging_sales_tenantId_saleDate_idx" ON "packaging_sales"("tenantId", "saleDate");

-- CreateIndex
CREATE INDEX "packaging_sales_tenantId_packagingTypeId_idx" ON "packaging_sales"("tenantId", "packagingTypeId");

-- AddForeignKey
ALTER TABLE "plastic_crate_movements" ADD CONSTRAINT "plastic_crate_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crate_cleanings" ADD CONSTRAINT "crate_cleanings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_types" ADD CONSTRAINT "packaging_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_sales" ADD CONSTRAINT "packaging_sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_sales" ADD CONSTRAINT "packaging_sales_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "packaging_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
