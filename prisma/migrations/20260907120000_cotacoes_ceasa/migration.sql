-- Módulo Cotações: preço do boletim diário da central, com destaque para o que
-- a empresa tem em estoque.
--
-- Quatro das cinco tabelas nascem SEM `tenantId`, e isso é decisão de modelagem,
-- não esquecimento: o preço publicado pela central é o mesmo para todo mundo que
-- compra ali. Guardá-lo por empresa multiplicaria a importação pelo número de
-- clientes e faria a tabela crescer sem nenhum ganho. Elas seguem o molde de
-- `rate_limits` — sem FK para tenant, lidas pelo cliente Prisma cru — e por
-- construção ficam fora da extensão multi-tenant.
--
-- `tenant_ceasa_links` é a única com `tenantId`, porque é a única coisa privada
-- aqui: a decisão de UMA empresa sobre qual produto do boletim corresponde ao
-- produto DELA. Esse vínculo é manual de propósito. Casamento automático por
-- nome quase nunca acerta ("Tomate" não é "TOMATE SALADA LONGA VIDA"), e
-- casamento por similaridade acerta — mas casa "TOMATE CEREJA" com "TOMATE
-- SALADA", que têm preços diferentes, sem avisar ninguém. Num módulo cujo
-- propósito é orientar preço, mostrar o preço errado com cara de certo é pior
-- que não mostrar preço nenhum.
--
-- Três detalhes do Postgres que governam o desenho das colunas:
--
--   * `ceasa_quotes.unit` é NOT NULL com default '' porque vários NULL NÃO
--     colidem em índice único. Com a unidade nula, reimportar o mesmo dia
--     criaria uma linha nova a cada execução em vez de atualizar a existente.
--   * `quoteDate` é DATE e não TIMESTAMP: a data do boletim é data de
--     calendário, não instante. Isso dispensa de saída todo o cuidado de fuso
--     que o resto do sistema precisa ter.
--   * os dois valores novos de `AdminNotificationKind` são apenas DECLARADOS
--     aqui. Um valor de enum criado dentro de uma transação não pode ser USADO
--     na mesma transação, e o Prisma roda cada migration em uma — inserir um
--     aviso com eles aqui quebraria o deploy.
--
-- As sete centrais da CEASAMINAS entram como INSERT desta migration, e não em
-- `prisma/seed.ts`: o seed é de desenvolvimento e nunca roda em produção, e sem
-- o catálogo o módulo não tem o que mostrar. `ON CONFLICT DO NOTHING` deixa a
-- migration repetível.
--
-- Nenhuma tabela existente perde dado: `tenants` só ganha uma coluna anulável.

-- CreateEnum
CREATE TYPE "CeasaImportStatus" AS ENUM ('OK', 'VAZIO', 'FALHA');

-- AlterEnum
ALTER TYPE "AdminNotificationKind" ADD VALUE 'COTACOES_FALHA';
ALTER TYPE "AdminNotificationKind" ADD VALUE 'COTACOES_DESATUALIZADAS';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "ceasaCentralCode" TEXT;

-- CreateTable
CREATE TABLE "ceasa_centrals" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceParams" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ceasa_centrals_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ceasa_products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ceasa_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceasa_quotes" (
    "id" TEXT NOT NULL,
    "centralCode" TEXT NOT NULL,
    "ceasaProductId" TEXT NOT NULL,
    "quoteDate" DATE NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "minPrice" DECIMAL(14,2),
    "avgPrice" DECIMAL(14,2),
    "maxPrice" DECIMAL(14,2),
    "refPrice" DECIMAL(14,2) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ceasa_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceasa_import_runs" (
    "id" TEXT NOT NULL,
    "centralCode" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "quoteDate" DATE,
    "status" "CeasaImportStatus" NOT NULL,
    "rowsParsed" INTEGER NOT NULL DEFAULT 0,
    "rowsUpserted" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "httpStatus" INTEGER,
    "error" TEXT,
    "fingerprint" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ceasa_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_ceasa_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ceasaProductId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ceasa_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ceasa_centrals_active_sortOrder_idx" ON "ceasa_centrals"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ceasa_products_slug_key" ON "ceasa_products"("slug");

-- CreateIndex
CREATE INDEX "ceasa_products_active_name_idx" ON "ceasa_products"("active", "name");

-- CreateIndex
CREATE INDEX "ceasa_quotes_centralCode_quoteDate_idx" ON "ceasa_quotes"("centralCode", "quoteDate");

-- CreateIndex
CREATE UNIQUE INDEX "ceasa_quotes_centralCode_quoteDate_ceasaProductId_unit_key" ON "ceasa_quotes"("centralCode", "quoteDate", "ceasaProductId", "unit");

-- CreateIndex
CREATE INDEX "ceasa_import_runs_centralCode_startedAt_idx" ON "ceasa_import_runs"("centralCode", "startedAt");

-- CreateIndex
CREATE INDEX "tenant_ceasa_links_tenantId_ceasaProductId_idx" ON "tenant_ceasa_links"("tenantId", "ceasaProductId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ceasa_links_tenantId_productId_key" ON "tenant_ceasa_links"("tenantId", "productId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ceasaCentralCode_fkey" FOREIGN KEY ("ceasaCentralCode") REFERENCES "ceasa_centrals"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceasa_quotes" ADD CONSTRAINT "ceasa_quotes_centralCode_fkey" FOREIGN KEY ("centralCode") REFERENCES "ceasa_centrals"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceasa_quotes" ADD CONSTRAINT "ceasa_quotes_ceasaProductId_fkey" FOREIGN KEY ("ceasaProductId") REFERENCES "ceasa_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceasa_import_runs" ADD CONSTRAINT "ceasa_import_runs_centralCode_fkey" FOREIGN KEY ("centralCode") REFERENCES "ceasa_centrals"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ceasa_links" ADD CONSTRAINT "tenant_ceasa_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ceasa_links" ADD CONSTRAINT "tenant_ceasa_links_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ceasa_links" ADD CONSTRAINT "tenant_ceasa_links_ceasaProductId_fkey" FOREIGN KEY ("ceasaProductId") REFERENCES "ceasa_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Catálogo das centrais da CEASAMINAS.
--
-- Os sete entrepostos usam o MESMO formulário de boletim, mudando só o código do
-- mercado — então um adaptador só (`ceasaminas`) atende todos, e o que os
-- distingue cabe em `sourceParams`.
INSERT INTO "ceasa_centrals" ("code", "name", "city", "uf", "sourceKey", "sourceParams", "sortOrder", "updatedAt") VALUES
  ('CEAMG', 'CEASAMINAS Grande BH',      'Contagem',             'MG', 'ceasaminas', '{"mercado":"CEAMG"}', 1, CURRENT_TIMESTAMP),
  ('CEARM', 'CEASAMINAS Juiz de Fora',   'Juiz de Fora',         'MG', 'ceasaminas', '{"mercado":"CEARM"}', 2, CURRENT_TIMESTAMP),
  ('CEART', 'CEASAMINAS Uberlandia',     'Uberlandia',           'MG', 'ceasaminas', '{"mercado":"CEART"}', 3, CURRENT_TIMESTAMP),
  ('CEARG', 'CEASAMINAS Uberaba',        'Uberaba',              'MG', 'ceasaminas', '{"mercado":"CEARG"}', 4, CURRENT_TIMESTAMP),
  ('CEARD', 'CEASAMINAS Gov. Valadares', 'Governador Valadares', 'MG', 'ceasaminas', '{"mercado":"CEARD"}', 5, CURRENT_TIMESTAMP),
  ('CEARB', 'CEASAMINAS Barbacena',      'Barbacena',            'MG', 'ceasaminas', '{"mercado":"CEARB"}', 6, CURRENT_TIMESTAMP),
  ('CECAT', 'CEASAMINAS Caratinga',      'Caratinga',            'MG', 'ceasaminas', '{"mercado":"CECAT"}', 7, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
