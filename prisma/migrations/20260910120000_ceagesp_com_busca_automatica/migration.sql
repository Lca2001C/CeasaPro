-- A CEAGESP de São Paulo passa a ter busca automática de boletim.
--
-- Nona praça com raspador (as oito anteriores são as sete da CEASAMINAS e a
-- Grande Vitória, todas pelo mesmo adaptador `ceasaminas`). O adaptador novo é
-- `src/lib/cotacoes/fontes/ceagesp.ts`, testado contra três fixtures capturadas
-- da fonte em `tests/unit/cotacoes-ceagesp.test.ts`.
--
-- SÓ a unidade de São Paulo (SPCEA)
--
-- As outras onze unidades "CEAGESP" do catálogo (Ribeirão Preto, Sorocaba,
-- Bauru, Campinas...) são servidas por uma PÁGINA DIFERENTE (`/cotacoes/interior/`),
-- que não foi medida. Marcá-las como automáticas com este adaptador faria a
-- importação buscar o boletim da capital e gravá-lo como se fosse o delas — o
-- preço de outra praça, com cara de certo. Continuam `manual`.
--
-- `sourceParams.grupos`: por que quatro, e não sete
--
-- A fonte só serve UM grupo por requisição (medido: `cot_grupo[]` devolve HTTP
-- 500, valor múltiplo devolve 200 sem tabela, e não há curinga). Buscar os sete
-- custa ~12 s e 573 linhas; os quatro de hortifruti custam ~7 s e 428 linhas.
-- Como `importarTodasAsCentrais` divide um orçamento de 40 s entre todas as
-- praças em uso, sete grupos numa praça só consumiriam quase um terço do
-- orçamento do dia.
--
-- Ficam de fora FLORES e PESCADOS (não são hortifruti — o cliente deste sistema
-- é dono de box de fruta e verdura) e ORGÂNICOS, que a própria fonte declara
-- como `null` na lista de publicações: nunca teve boletim.
--
-- `maxDiasSemBoletim = 5`, e não o padrão 7
--
-- A CEAGESP publica três vezes por semana (segunda, quarta e sexta, segundo a
-- própria página) e NÃO serve o dia corrente — a página instrui a escolher data
-- anterior a hoje. Então o boletim mais novo que existe é o do dia útil
-- anterior, e na segunda-feira o disponível é o de sexta: 3 dias. Com um feriado
-- na segunda, 5.
--
-- Cinco é o número que faz o selo de "boletim antigo" e o alarme de defasagem
-- dizerem a verdade nesta praça: com 7 (o padrão), uma semana inteira sem
-- publicação passaria calada; com 3, toda segunda-feira acenderia alarme para o
-- comportamento normal da fonte.
UPDATE "ceasa_centrals"
   SET "sourceKey" = 'ceagesp',
       "sourceParams" = '{"grupos":["DIVERSOS","FRUTAS","LEGUMES","VERDURAS"]}'::jsonb,
       "maxDiasSemBoletim" = 5,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "code" = 'SPCEA';
