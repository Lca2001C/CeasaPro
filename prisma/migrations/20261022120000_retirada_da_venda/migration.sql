-- Retirada da venda: o cliente leva na hora ou busca depois.
ALTER TABLE "sales" ADD COLUMN "retirarDepois" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales" ADD COLUMN "retiradoEm" TIMESTAMP(3);

-- Venda antiga saiu do balcão na hora.
UPDATE "sales" SET "retiradoEm" = "createdAt" WHERE "retiradoEm" IS NULL;

-- Só as que aguardam retirada (lista do aviso e do filtro): poucas linhas.
CREATE INDEX "sales_aguardando_retirada"
  ON "sales" ("tenantId", "saleDate")
  WHERE "retirarDepois" = true AND "retiradoEm" IS NULL
    AND "cancelledAt" IS NULL AND "deletedAt" IS NULL;
