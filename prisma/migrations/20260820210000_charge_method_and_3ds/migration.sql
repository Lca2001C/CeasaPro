-- Método de cobrança da mensalidade vira enum (PIX / CREDIT_CARD / DEBIT_CARD)
-- e o pagamento passa a guardar o detalhe do status e o desafio 3DS do débito.
-- O backfill roda ANTES do cast: nenhuma linha existente é perdida.

-- CreateEnum
CREATE TYPE "ChargeMethod" AS ENUM ('PIX', 'CREDIT_CARD', 'DEBIT_CARD');

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "statusDetail" TEXT;
ALTER TABLE "subscription_payments" ADD COLUMN     "threeDsUrl" TEXT;

-- Normaliza os valores legados gravados como texto livre ('pix', 'card').
-- Qualquer valor não reconhecido vira NULL (o método é opcional).
UPDATE "subscription_payments" SET "method" = 'PIX'
  WHERE lower("method") IN ('pix', 'bank_transfer');
UPDATE "subscription_payments" SET "method" = 'CREDIT_CARD'
  WHERE lower("method") IN ('card', 'credit_card', 'cartao', 'cartão');
UPDATE "subscription_payments" SET "method" = 'DEBIT_CARD'
  WHERE lower("method") = 'debit_card';
UPDATE "subscription_payments" SET "method" = NULL
  WHERE "method" IS NOT NULL
    AND "method" NOT IN ('PIX', 'CREDIT_CARD', 'DEBIT_CARD');

-- AlterTable: converte a coluna de TEXT para o enum já normalizado.
ALTER TABLE "subscription_payments"
  ALTER COLUMN "method" TYPE "ChargeMethod" USING "method"::"ChargeMethod";
