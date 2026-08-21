-- Go-Live: fim do período gratuito + prova de aceite dos termos (LGPD).
--
-- A ordem importa: primeiro esvaziamos o valor TRIAL das linhas, depois
-- recriamos o enum sem ele (o PostgreSQL não remove valor de enum in-place).

-- ─────────── 1) Nenhuma empresa continua "em teste" ───────────
-- Quem estava em TRIAL passa a SUSPENSO: sem acesso até o 1º pagamento aprovado.
UPDATE "tenant_subscriptions" SET "status" = 'SUSPENSO' WHERE "status" = 'TRIAL';

-- ─────────── 2) activatedAt: marca a primeira ativação ───────────
ALTER TABLE "tenant_subscriptions" ADD COLUMN "activatedAt" TIMESTAMP(3);

-- Backfill: quem já pagou ao menos uma vez mantém o direito à tolerância de
-- graceDays. Sem isto, toda a base cairia em SUSPENSO no próximo recálculo.
UPDATE "tenant_subscriptions" s
SET "activatedAt" = p."firstPaid"
FROM (
  SELECT "subscriptionId", MIN("paidAt") AS "firstPaid"
  FROM "subscription_payments"
  WHERE "status" = 'APROVADO' AND "paidAt" IS NOT NULL
  GROUP BY "subscriptionId"
) p
WHERE p."subscriptionId" = s."id";

-- ─────────── 3) trialEndsAt deixa de existir ───────────
ALTER TABLE "tenant_subscriptions" DROP COLUMN "trialEndsAt";

-- ─────────── 4) Enum SubscriptionStatus sem TRIAL ───────────
ALTER TYPE "SubscriptionStatus" RENAME TO "SubscriptionStatus_old";

CREATE TYPE "SubscriptionStatus" AS ENUM ('ATIVO', 'VENCIDO', 'SUSPENSO', 'BLOQUEADO', 'CANCELADO');

-- O DEFAULT precisa sair antes do cast: ele ainda aponta para o tipo antigo.
ALTER TABLE "tenant_subscriptions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tenant_subscriptions"
  ALTER COLUMN "status" TYPE "SubscriptionStatus" USING ("status"::text::"SubscriptionStatus");
ALTER TABLE "tenant_subscriptions" ALTER COLUMN "status" SET DEFAULT 'SUSPENSO';

DROP TYPE "SubscriptionStatus_old";

-- ─────────── 5) Aceite dos Termos / Política de Privacidade ───────────
ALTER TABLE "tenants"
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "termsAcceptedIp" TEXT,
  ADD COLUMN "termsVersion" TEXT;
