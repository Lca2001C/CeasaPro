-- Estoque inicial pode entrar sem custo. A quantidade conta; a média, o valor,
-- o CMV, o lucro e a margem não usam essa carga. Venda antiga fica com
-- quantidadeComCusto nulo, que o cálculo lê como a linha inteira.

ALTER TABLE "sale_items" ALTER COLUMN "unitCostAtSale" DROP NOT NULL;
ALTER TABLE "sale_items" ADD COLUMN "quantidadeComCusto" DECIMAL(14,3);

ALTER TABLE "stock_cost_checkpoints" ADD COLUMN "saldoSemCusto" DECIMAL(14,3) NOT NULL DEFAULT 0;
