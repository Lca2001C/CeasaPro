-- Estoque unificado (produto com preço, alerta e foto), banco de fotos da
-- plataforma e a despesa gerada por toda compra.

-- CreateEnum
CREATE TYPE "ExpenseOrigem" AS ENUM ('MANUAL', 'COMPRA', 'FRETE_COMPRA');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "minStock" DECIMAL(14,3),
ADD COLUMN     "salePrice" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "origem" "ExpenseOrigem" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "catalogo_imagens" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalogo_imagens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalogo_imagens_imageKey_key" ON "catalogo_imagens"("imageKey");

-- CreateIndex
CREATE INDEX "catalogo_imagens_ativo_slug_idx" ON "catalogo_imagens"("ativo", "slug");

-- CreateIndex
CREATE INDEX "expenses_tenantId_supplierId_idx" ON "expenses"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "expenses_tenantId_origem_idx" ON "expenses"("tenantId", "origem");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma despesa de COMPRA viva por compra. Parcial porque o Prisma não declara
-- índice com WHERE: a despesa manual (purchaseId nulo) e o frete legado
-- (FRETE_COMPRA) ficam de fora.
CREATE UNIQUE INDEX "expenses_compra_unica"
  ON "expenses"("tenantId", "purchaseId")
  WHERE "origem" = 'COMPRA' AND "deletedAt" IS NULL;

-- >>> BACKFILL (tests/integration/compra-despesa-backfill.test.ts executa este trecho)
-- Categoria padrão das compras para as empresas que já existem.
INSERT INTO "expense_categories" ("id", "tenantId", "name", "isDefault", "createdAt", "updatedAt")
SELECT 'cmp' || md5(t."id" || clock_timestamp()::text || random()::text), t."id",
       'Compra de mercadoria', true, now(), now()
FROM "tenants" t
ON CONFLICT ("tenantId", "name") DO NOTHING;

-- Antes desta versão, a única despesa ligada a compra era o frete lançado à
-- parte ("Lançar o frete como despesa").
UPDATE "expenses" e
SET "origem" = 'FRETE_COMPRA',
    "supplierId" = p."supplierId"
FROM "purchases" p
WHERE e."purchaseId" = p."id"
  AND e."origem" = 'MANUAL';

-- A despesa de cada compra antiga nasce PAGA no dia da compra — é como o fluxo
-- de caixa já contava a compra. Se o frete já tinha despesa viva própria, ele
-- sai do valor, senão entraria duas vezes em Contas a Pagar e no caixa.
INSERT INTO "expenses" (
  "id", "tenantId", "categoryId", "description", "amount", "dueDate", "paidDate",
  "type", "status", "recurring", "purchaseId", "supplierId", "origem",
  "createdAt", "updatedAt"
)
SELECT 'cmp' || md5(p."id" || clock_timestamp()::text || random()::text),
       p."tenantId",
       (SELECT c."id" FROM "expense_categories" c
         WHERE c."tenantId" = p."tenantId" AND c."name" = 'Compra de mercadoria'
           AND c."deletedAt" IS NULL),
       CASE WHEN s."name" IS NOT NULL THEN 'Compra — ' || s."name" ELSE 'Compra sem fornecedor' END
         || CASE WHEN p."freight" > 0 AND NOT f.tem_frete
                 THEN ' (inclui frete R$ ' || replace(to_char(p."freight", 'FM999999990.00'), '.', ',') || ')'
                 ELSE '' END,
       CASE WHEN f.tem_frete THEN p."totalAmount" - p."freight" ELSE p."totalAmount" END,
       p."purchaseDate",
       p."purchaseDate",
       'VARIAVEL',
       'PAGO',
       false,
       p."id",
       p."supplierId",
       'COMPRA',
       now(),
       now()
FROM "purchases" p
LEFT JOIN "suppliers" s ON s."id" = p."supplierId"
CROSS JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1 FROM "expenses" fe
    WHERE fe."purchaseId" = p."id" AND fe."origem" = 'FRETE_COMPRA' AND fe."deletedAt" IS NULL
  ) AS tem_frete
) f
WHERE p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "expenses" ce
    WHERE ce."purchaseId" = p."id" AND ce."origem" = 'COMPRA' AND ce."deletedAt" IS NULL
  )
  AND (CASE WHEN f.tem_frete THEN p."totalAmount" - p."freight" ELSE p."totalAmount" END) > 0;
-- <<< BACKFILL
