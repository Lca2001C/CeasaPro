-- Separa as duas taxonomias de produto, para o banco IMPEDIR o que o módulo
-- decidiu não fazer.
--
-- O módulo tem uma regra escrita desde o primeiro dia: não casar produtos por
-- similaridade, porque mostrar o preço errado com cara de certo é pior que não
-- mostrar preço. Até agora essa regra era só um comentário. Ela passa a ser uma
-- restrição do banco.
--
-- O DEFEITO QUE ISTO FECHA é medido, não hipotético. O boletim da praça e a série
-- nacional usam nomes e unidades que COINCIDEM em três produtos:
--
--     UVA ITALIA   — boletim: KG        | nacional: KG   <- colide inteiro
--     UVA NIAGARA  — boletim: KG        | nacional: KG   <- colide inteiro
--     COCO VERDE   — boletim: UN 1,5 KG | nacional: UN
--
-- Com `slug` único GLOBAL, "UVA ITALIA" das duas fontes vira o MESMO
-- `ceasa_products`. Aí a chave inteira de `ceasa_quotes`
-- (centralCode, quoteDate, ceasaProductId, unit) coincide, e o
-- `ON CONFLICT DO UPDATE` da gravação faz a última importação do dia sobrescrever
-- a outra EM SILÊNCIO — apagando o mínimo e o máximo reais do boletim quando a
-- série nacional, que traz um preço só, chega por último. Nada erraria de forma
-- visível: a tela mostraria um número plausível, do jeito errado.
--
-- Também derruba uma premissa falsa que estava escrita em vários comentários
-- deste módulo: a de que as duas séries se distinguiriam pela unidade ("R$/kg
-- contra R$/caixa"). Medindo o boletim real, 173 das 215 linhas são KG — 80%.
-- A unidade não separa nada; só o discriminador separa.
--
-- Fica em `ceasa_products` e não em `ceasa_quotes` de propósito: assim um produto
-- de catálogo pertence a EXATAMENTE uma taxonomia, e não existe forma de gravar
-- um produto alimentado pelas duas fontes. Em `ceasa_quotes` resolveria a
-- sobrescrita, mas deixaria um único produto "UVA ITALIA" na tela de vínculo, com
-- o cliente escolhendo sem saber a qual série está se ligando.
--
-- `DEFAULT 'CENTRAL'` está certo para o que existe hoje: todo produto já gravado
-- veio do boletim de praça. `tenant_ceasa_links` aponta para `ceasaProductId`, e
-- portanto todo vínculo existente passa a ser um vínculo a uma série sem
-- migração de dados.

-- CreateEnum
CREATE TYPE "CeasaSerie" AS ENUM ('CENTRAL', 'NACIONAL');

-- AlterTable
ALTER TABLE "ceasa_products" ADD COLUMN "serie" "CeasaSerie" NOT NULL DEFAULT 'CENTRAL';

-- O índice único deixa de ser global e passa a ser POR SÉRIE.
DROP INDEX IF EXISTS "ceasa_products_slug_key";
CREATE UNIQUE INDEX "ceasa_products_serie_slug_key" ON "ceasa_products"("serie", "slug");

-- Serve a listagem do catálogo filtrada por série (tela de vínculo e comparação).
CREATE INDEX "ceasa_products_serie_active_name_idx" ON "ceasa_products"("serie", "active", "name");
