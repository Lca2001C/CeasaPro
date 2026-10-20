-- CreateTable
CREATE TABLE "tenant_ceasa_link_recusas" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_ceasa_link_recusas_pkey" PRIMARY KEY ("tenantId","productId")
);

-- AddForeignKey
ALTER TABLE "tenant_ceasa_link_recusas" ADD CONSTRAINT "tenant_ceasa_link_recusas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ceasa_link_recusas" ADD CONSTRAINT "tenant_ceasa_link_recusas_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
