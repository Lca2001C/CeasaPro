-- Índices para as leituras que o Início, o sino e o push repetem a cada abertura.

-- Contas PENDENTE por vencimento (avisos, contas a pagar, próximas contas).
CREATE INDEX "expenses_tenantId_status_dueDate_idx"
  ON "expenses"("tenantId", "status", "dueDate");

-- Vendas aguardando retirada: o filtro dos avisos, do sino, do push e de
-- /vendas percorria todas as vendas da empresa pelo índice (tenantId, saleDate).
-- Parcial: só as poucas vendas ainda não buscadas entram nele.
CREATE INDEX "sales_retirada_pendente_idx"
  ON "sales"("tenantId", "saleDate")
  WHERE "retirarDepois" AND "retiradoEm" IS NULL AND "cancelledAt" IS NULL;
