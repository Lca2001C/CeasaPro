-- Cobrança: reconciliação com rotação e pagamento aprovado que não foi creditado.
--
-- `lastReconciledAt` é a fila da reconciliação diária: nunca conferidas
-- primeiro, depois as conferidas há mais tempo. Com orçamento de tempo, o lote
-- pode ser cortado — e sem rotação o corte deixava sempre as mesmas de fora.
--
-- `uncreditedAt`/`uncreditedReason` marcam o pagamento que o Mercado Pago
-- aprovou e que NÃO comprou mês (valor a menor, segunda aprovação da
-- competência). A marca faz o aviso ao super-admin sair uma vez só.
--
-- PostgreSQL 12+ aceita mais de um ADD VALUE na mesma migração (o banco local
-- e o Neon estão acima disso); os valores novos não são usados aqui dentro.

-- AlterEnum
ALTER TYPE "AdminNotificationKind" ADD VALUE 'PAGAMENTO_NAO_CREDITADO';
ALTER TYPE "AdminNotificationKind" ADD VALUE 'BLOQUEIO_DESFEITO_POR_PAGAMENTO';

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "lastReconciledAt" TIMESTAMP(3),
ADD COLUMN     "uncreditedAt" TIMESTAMP(3),
ADD COLUMN     "uncreditedReason" TEXT;

-- CreateIndex
CREATE INDEX "subscription_payments_status_lastReconciledAt_idx" ON "subscription_payments"("status", "lastReconciledAt");
