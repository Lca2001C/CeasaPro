-- Cada pagamento ao higienizador passa a ter linha própria, com a data em que
-- saiu do caixa.
--
-- `crate_cleanings.paidAmount` é acumulado e `paidDate` é sobrescrito a cada
-- pagamento, então os dois juntos não dizem quanto saiu em que dia. O fluxo de
-- caixa somava `paidAmount` agrupando por `paidDate`, o que jogava o valor
-- cheio do lote no dia do ÚLTIMO pagamento e sumia com o lote quando esse dia
-- caía fora do período.

CREATE TABLE "crate_cleaning_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cleaningId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crate_cleaning_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crate_cleaning_payments_tenantId_paidAt_idx" ON "crate_cleaning_payments"("tenantId", "paidAt");

CREATE INDEX "crate_cleaning_payments_cleaningId_idx" ON "crate_cleaning_payments"("cleaningId");

ALTER TABLE "crate_cleaning_payments" ADD CONSTRAINT "crate_cleaning_payments_cleaningId_fkey" FOREIGN KEY ("cleaningId") REFERENCES "crate_cleanings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: o histórico só tem o acumulado e a data do último pagamento, então
-- vira UMA parcela por lote. Não recupera o parcelamento antigo — isso é
-- impossível a partir do que foi guardado —, mas mantém o fluxo de caixa
-- somando o mesmo total de antes em vez de zerar o passado.
INSERT INTO "crate_cleaning_payments" ("id", "tenantId", "cleaningId", "amount", "paidAt", "createdAt")
SELECT
    'bf-' || "id",
    "tenantId",
    "id",
    "paidAmount",
    COALESCE("paidDate", "updatedAt"),
    CURRENT_TIMESTAMP
FROM "crate_cleanings"
WHERE "paidAmount" > 0;
