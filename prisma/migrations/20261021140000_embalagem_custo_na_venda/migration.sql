-- Custo médio da embalagem gravado na venda: o lucro do mês desconta o custo
-- da embalagem vendida (antes entrava como receita sem custo nenhum).
ALTER TABLE "packaging_sales" ADD COLUMN "unitCostAtSale" DECIMAL(14,4);
