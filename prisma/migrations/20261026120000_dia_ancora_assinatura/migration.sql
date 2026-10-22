-- Dia âncora do vencimento mensal da assinatura (1–31). Sem preenchimento:
-- um vencimento hoje em 28 pode ser um 31 que deslizou, e o vencimento sozinho
-- não diz qual. A próxima aprovação decide pelo histórico de pagamentos
-- (`diaAncoraDoHistorico`) e grava; sem histórico conclusivo, vale o dia do
-- vencimento atual — o mesmo resultado de antes desta coluna.
ALTER TABLE "tenant_subscriptions" ADD COLUMN "diaAncora" INTEGER;
ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_dia_ancora_valido"
  CHECK ("diaAncora" IS NULL OR ("diaAncora" BETWEEN 1 AND 31));
