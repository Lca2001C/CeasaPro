-- Correção de dados: nenhuma empresa pode ter acesso liberado sem ter pago.
--
-- Antes do Go-Live, empresas criadas com "0 dias de trial" nasciam ATIVAS sem
-- nenhum pagamento aprovado. Com o fim do período gratuito isso vira acesso
-- gratuito por descuido, então essas assinaturas voltam para SUSPENSO.
--
-- `activatedAt` já foi preenchido pela migration anterior a partir do primeiro
-- pagamento aprovado, então quem realmente pagou não é afetado aqui.
UPDATE "tenant_subscriptions"
SET "status" = 'SUSPENSO'
WHERE "activatedAt" IS NULL
  AND "status" IN ('ATIVO', 'VENCIDO');
