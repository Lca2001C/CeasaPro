-- Três travas que a auditoria apontou como brechas de receita e de identidade.
--
-- 1. TROCA DE PLANO AGENDADA (`pendingPlanId` / `pendingPlanFrom`)
--
-- `changePlan` valia na hora, sempre. Quem já tinha pago a competência no plano
-- básico trocava para o completo no dia seguinte e usava o mês inteiro pelo
-- preço do básico — o valor novo só seria cobrado na renovação. No sentido
-- inverso o prejuízo era do cliente: o downgrade tirava na hora módulos que ele
-- havia acabado de pagar. Com a competência paga, a troca passa a ser AGENDADA
-- para `currentPeriodEnd`, que é onde a competência seguinte começa.
--
-- 2. UMA COBRANÇA APROVADA POR COMPETÊNCIA (`approvedKey`)
--
-- Nada impedia duas linhas APROVADAS no mesmo `referenceMonth`. Dois webhooks
-- concorrentes (ou PIX pago depois do cartão já aprovado) creditavam o período
-- duas vezes; e a reversão de UM deles suspendia a empresa mesmo com o outro
-- pagamento válido em pé. A coluna carrega `<tenantId>:<referenceMonth>` só
-- enquanto a cobrança está APROVADA e é `UNIQUE`: como vários NULL não colidem
-- em índice único no Postgres, o resto dos status continua livre para repetir.
--
-- O índice `(tenantId, referenceMonth, status)` é a leitura que virou quente:
-- toda aprovação e toda reversão agora perguntam "sobra outro pagamento válido
-- deste mês?".
--
-- 3. IDENTIDADE DO E-MAIL (`emailIdentity`)
--
-- O trial era concedido por endereço textual, então `dono+1@gmail.com`,
-- `dono+2@gmail.com` e `d.o.n.o@gmail.com` rendiam três testes grátis na mesma
-- caixa de entrada. A coluna guarda a forma RAIZ (sem `+tag`, e sem os pontos
-- nos provedores que os ignoram) e é ela que `emailEmUso` consulta. `email`
-- continua com o endereço digitado, que é para onde a mensagem é entregue.
--
-- O backfill abaixo repete em SQL as MESMAS regras de `src/lib/email-identity.ts`
-- para as contas que já existem. Só contas vivas: linha excluída tem o e-mail
-- carimbado (`excluido-<id>-…`) e não deve segurar identidade nenhuma.
--
-- Custo: as quatro colunas são anuláveis, e desde o Postgres 11 `ADD COLUMN`
-- anulável é alteração de metadado — não reescreve tabela.

-- 1) Troca de plano agendada ------------------------------------------------
ALTER TABLE "tenant_subscriptions" ADD COLUMN "pendingPlanId" TEXT;
ALTER TABLE "tenant_subscriptions" ADD COLUMN "pendingPlanFrom" TIMESTAMP(3);

ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_pendingPlanId_fkey"
  FOREIGN KEY ("pendingPlanId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tenant_subscriptions_pendingPlanFrom_idx"
  ON "tenant_subscriptions"("pendingPlanFrom");

-- 2) Uma cobrança aprovada por competência ----------------------------------
ALTER TABLE "subscription_payments" ADD COLUMN "approvedKey" TEXT;

-- Retroativo. `DISTINCT ON` mantém a cobrança aprovada MAIS ANTIGA de cada
-- competência: é a que efetivamente abriu o período. Se alguma base já tiver
-- duplicidade, a segunda linha fica sem chave em vez de derrubar a migration —
-- o dado permanece auditável e a trava passa a valer daqui para frente.
UPDATE "subscription_payments" p
SET "approvedKey" = p."tenantId" || ':' || p."referenceMonth"
FROM (
  SELECT DISTINCT ON ("tenantId", "referenceMonth") "id"
  FROM "subscription_payments"
  WHERE "status" = 'APROVADO'
  ORDER BY "tenantId", "referenceMonth", "paidAt" ASC NULLS LAST, "createdAt" ASC
) primeira
WHERE p."id" = primeira."id";

CREATE UNIQUE INDEX "subscription_payments_approvedKey_key"
  ON "subscription_payments"("approvedKey");

CREATE INDEX "subscription_payments_tenantId_referenceMonth_status_idx"
  ON "subscription_payments"("tenantId", "referenceMonth", "status");

-- 3) Identidade do e-mail ---------------------------------------------------
ALTER TABLE "users" ADD COLUMN "emailIdentity" TEXT;

UPDATE "users"
SET "emailIdentity" =
  CASE
    -- Gmail: ignora pontos no nome E o sufixo `+tag`; googlemail é o mesmo domínio.
    WHEN split_part(lower("email"), '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(split_part(lower("email"), '@', 1), '+', 1), '.', '')
           || '@gmail.com'
    -- Outlook e família: só o sufixo `+tag` (os pontos fazem parte do endereço).
    WHEN split_part(lower("email"), '@', 2) IN (
      'outlook.com', 'outlook.com.br', 'hotmail.com', 'hotmail.com.br',
      'live.com', 'live.com.br', 'msn.com',
      'icloud.com', 'me.com', 'mac.com',
      'proton.me', 'protonmail.com', 'pm.me',
      'fastmail.com', 'zoho.com'
    )
      THEN split_part(split_part(lower("email"), '@', 1), '+', 1)
           || '@' || split_part(lower("email"), '@', 2)
    ELSE lower("email")
  END
WHERE "deletedAt" IS NULL
  AND "email" LIKE '%@%';

CREATE INDEX "users_emailIdentity_idx" ON "users"("emailIdentity");
