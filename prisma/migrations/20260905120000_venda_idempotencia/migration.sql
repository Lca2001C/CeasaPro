-- Chave de idempotência da venda.
--
-- O POST /api/vendas não tinha defesa nenhuma contra reentrega: sem chave, sem
-- dedup e sem constraint. Com a rede do CEASA oscilando, o pedido chegava ao
-- servidor, a transação commitava e a resposta se perdia; o operador via
-- "Falha de conexão. Tente novamente." — uma mensagem que MANDA repetir — e o
-- segundo toque registrava a venda outra vez: estoque baixado em dobro,
-- segunda conta de fiado no mesmo nome, duas saídas de caixa plástica. Não
-- havia como o servidor distinguir retentativa de venda nova, e no balcão duas
-- vendas idênticas em sequência são corriqueiras (mesmo cliente, mesmos 10 kg),
-- então deduplicar por hash do carrinho recusaria dinheiro real.
--
-- A coluna é anulável: vendas antigas e o fiado manual (que não tem carrinho)
-- ficam com NULL. No Postgres vários NULL não colidem num índice único, então
-- convivem sem precisar de índice parcial.
ALTER TABLE "sales" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "sales_tenantId_idempotencyKey_key"
  ON "sales"("tenantId", "idempotencyKey");
