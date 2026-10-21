-- Venda de embalagem passa a ser CANCELADA (até 24 h, marcada, estoque volta por
-- estorno) em vez de apagada a qualquer tempo.
ALTER TABLE "packaging_sales" ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelReason" TEXT;

-- Recebimento de fiado depois da baixa como perda (dinheiro recuperado).
ALTER TABLE "credit_payments" ADD COLUMN "aposBaixa" BOOLEAN NOT NULL DEFAULT false;
