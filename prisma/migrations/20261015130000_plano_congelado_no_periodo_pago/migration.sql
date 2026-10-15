-- O período pago entrega os módulos e o preço da hora em que foi contratado.
-- Editar o catálogo (preço ou módulos) não muda o que já foi pago nem o que já
-- foi agendado.

-- AlterTable
ALTER TABLE "tenant_subscriptions" ADD COLUMN     "pendingPriceMonthly" DECIMAL(10,2),
ADD COLUMN     "pendingFeatures" JSONB,
ADD COLUMN     "heldFeatures" JSONB,
ADD COLUMN     "heldFeaturesUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "features" JSONB;
