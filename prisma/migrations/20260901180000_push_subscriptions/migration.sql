-- Web Push: inscrições por navegador/dispositivo.
--
-- `endpoint` é UNIQUE de propósito. Ele é gerado pelo navegador e é único por
-- instalação, então é a chave natural: reinscrever o mesmo aparelho tem de
-- ATUALIZAR a linha, não criar outra. Sem essa restrição, cada vez que o usuário
-- reabrisse o opt-in a pessoa passaria a receber a mesma notificação em duplicado
-- — e o efeito só apareceria em produção, no celular do cliente.
--
-- `userId` com ON DELETE CASCADE: quem autorizou foi a pessoa, no aparelho dela.
-- Excluir o usuário tem de levar as inscrições, senão o servidor seguiria enviando
-- para um destino sem dono.
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_tenantId_idx" ON "push_subscriptions"("tenantId");
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
