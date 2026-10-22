-- Caixa plástica: um estoque só para Caixas e Embalagens.
--
-- O tipo de embalagem "Caixa plástica" tinha estoque próprio em
-- `packaging_movements`, e vendê-lo não tirava nada das caixas do módulo de
-- caixas. Agora o tipo marcado `caixaPlastica` lê o saldo das caixas LIMPAS e
-- grava a venda (VENDA) e a entrada no livro-razão de caixas.

-- Caixa vendida como embalagem: sai das limpas e não volta.
ALTER TYPE "PlasticCrateMovementType" ADD VALUE 'VENDA';

ALTER TABLE "packaging_types" ADD COLUMN "caixaPlastica" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "plastic_crate_movements"
  ADD COLUMN "unitCost" DECIMAL(14,4),
  ADD COLUMN "packagingSaleId" TEXT,
  ADD COLUMN "estornaId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "expenses" ADD COLUMN "plasticCrateMovementId" TEXT;

CREATE UNIQUE INDEX "plastic_crate_movements_tenantId_idempotencyKey_key"
  ON "plastic_crate_movements"("tenantId", "idempotencyKey");
CREATE INDEX "plastic_crate_movements_packagingSaleId_idx"
  ON "plastic_crate_movements"("packagingSaleId");
CREATE INDEX "plastic_crate_movements_estornaId_idx"
  ON "plastic_crate_movements"("estornaId");
CREATE UNIQUE INDEX "expenses_plasticCrateMovementId_key"
  ON "expenses"("plasticCrateMovementId");

ALTER TABLE "plastic_crate_movements"
  ADD CONSTRAINT "plastic_crate_movements_packagingSaleId_fkey"
  FOREIGN KEY ("packagingSaleId") REFERENCES "packaging_sales"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- No máximo um tipo vinculado às caixas por empresa.
CREATE UNIQUE INDEX "packaging_types_caixa_plastica_unica"
  ON "packaging_types"("tenantId")
  WHERE "caixaPlastica" AND "deletedAt" IS NULL;

-- Marca o tipo padrão "Caixa plástica" de cada empresa (sem acento e sem
-- caixa na comparação). Duas grafias na mesma empresa: fica a mais antiga.
WITH candidatos AS (
  SELECT DISTINCT ON ("tenantId") id
  FROM "packaging_types"
  WHERE "deletedAt" IS NULL
    AND translate(lower(btrim(name)), 'áàâã', 'aaaa') = 'caixa plastica'
  ORDER BY "tenantId", "createdAt", id
)
UPDATE "packaging_types" t
SET "caixaPlastica" = true
FROM candidatos c
WHERE t.id = c.id;
