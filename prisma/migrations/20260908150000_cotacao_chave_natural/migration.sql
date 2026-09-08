-- A cotação passa a ser identificada pela sua chave NATURAL.
--
-- Medido com 205 mil cotações reais no banco:
--
--     ceasa_quotes_pkey (o `id` de cuid) ............ 15 MB, 0 leituras
--     chave única natural ........................... 18 MB, 223.178 leituras
--     centralCode + quoteDate ....................... 2 MB, 1.158 leituras
--
-- O `id` era 23% do tamanho da tabela e nunca foi lido: nada no código busca
-- cotação por id, e nenhuma chave estrangeira aponta para ela (verificado no
-- `information_schema`). Era um índice pago em espaço E em uma escrita a mais por
-- linha inserida, sem nenhuma leitura em troca — e a importação insere em lote,
-- que é exatamente onde esse custo dói.
--
-- A chave natural (central, data, produto, unidade) já era única e já era a
-- identidade real da linha. Promovê-la a chave primária elimina o índice
-- redundante em vez de manter dois índices dizendo a mesma coisa.
--
-- Nada além disso muda: a mesma chave, o mesmo ON CONFLICT, a mesma idempotência.

ALTER TABLE "ceasa_quotes" DROP CONSTRAINT "ceasa_quotes_pkey";
ALTER TABLE "ceasa_quotes" DROP COLUMN "id";
-- Criado como ÍNDICE único (não como constraint) pela migration original, então sai
-- com DROP INDEX. A chave primaria composta abaixo o substitui integralmente.
DROP INDEX "ceasa_quotes_centralCode_quoteDate_ceasaProductId_unit_key";
ALTER TABLE "ceasa_quotes" ADD CONSTRAINT "ceasa_quotes_pkey"
  PRIMARY KEY ("centralCode", "quoteDate", "ceasaProductId", "unit");
