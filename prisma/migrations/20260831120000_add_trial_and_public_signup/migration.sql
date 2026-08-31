-- Cadastro público + 7 dias de teste grátis.
--
-- Reintroduz o período gratuito removido no Go-Live (20260820230000), agora com
-- duas travas que não existiam antes:
--   1) o trial só começa quando o e-mail é CONFIRMADO (sem cartão, e-mail
--      descartável renderia trial ilimitado);
--   2) ele vale só para cadastros novos.
--
-- Por isso NENHUMA linha existente recebe `trialEndsAt` aqui. Empresas que já
-- estão SUSPENSO por nunca terem pagado continuam suspensas — devolver acesso a
-- elas reabriria justamente a brecha que a 20260820233000 fechou.

-- ─────────── 1) TRIAL volta ao enum ───────────
-- ATENÇÃO: no PostgreSQL o valor acrescentado por ADD VALUE não pode ser USADO
-- na mesma transação em que foi criado. Como nada aqui grava 'TRIAL', não há
-- conflito — não acrescente `UPDATE ... SET status = 'TRIAL'` a esta migration.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'TRIAL';

-- ─────────── 2) Fim do teste grátis ───────────
ALTER TABLE "tenant_subscriptions" ADD COLUMN "trialEndsAt" TIMESTAMP(3);

-- ─────────── 3) Confirmação de e-mail do cadastro público ───────────
ALTER TABLE "users"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifyTokenHash" TEXT,
  ADD COLUMN "verifyTokenExpiresAt" TIMESTAMP(3);

-- A confirmação busca o usuário PELO hash do token; sem índice isso é varredura
-- completa da tabela em rota pública. Mesmo motivo da 20260824120000 para o
-- token de redefinição de senha.
CREATE INDEX "users_verifyTokenHash_idx" ON "users"("verifyTokenHash");

-- Quem já é cliente não precisa confirmar e-mail: foi cadastrado pelo
-- super-admin, que validou o contato. Sem este backfill, um requisito futuro que
-- exija `emailVerifiedAt` trataria a base inteira como não verificada.
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "deletedAt" IS NULL;

-- ─────────── 4) Tipo de estabelecimento / box ───────────
ALTER TABLE "tenants" ADD COLUMN "establishmentType" TEXT;
