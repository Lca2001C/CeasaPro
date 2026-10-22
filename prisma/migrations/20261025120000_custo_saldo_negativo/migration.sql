-- O custo médio passou a pesar as entradas pelo saldo REAL quando o ciclo
-- recomeça num saldo negativo (`sqlCustoEstoque`). Os checkpoints gravados com
-- a regra antiga embutem o número antigo: apagados aqui, o cron de billing os
-- refaz (ou `npx tsx scripts/recalcular-checkpoints.ts`). Tabela derivada —
-- apagar não muda número nenhum, só deixa a conta mais cara até o refazer.
DELETE FROM "stock_cost_checkpoints";
