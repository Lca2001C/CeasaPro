-- Corrige erros de FATO no catálogo nacional de centrais.
--
-- A migration anterior montou a lista nacional a partir de conhecimento geral,
-- sem conferir unidade por unidade em fonte oficial. Quatro erros foram
-- confirmados depois, consultando os sites das próprias companhias:
--
--   * SANTA CATARINA tem TRÊS unidades — São José, Blumenau e Tubarão. Eu havia
--     cadastrado seis: Joinville, Chapecó, Criciúma e Rio do Sul NÃO existem, e
--     Tubarão, que existe, estava faltando.
--   * CEARÁ tem TRÊS entrepostos — Maracanaú, Tianguá e Barbalha. Sobral não é
--     um deles.
--   * RIO DE JANEIRO tem SEIS unidades — Grande Rio (Irajá), São Gonçalo, Nova
--     Friburgo, Itaocara, São José de Ubá e Paty do Alferes. Não há unidade em
--     Campos dos Goytacazes, e as outras cinco estavam faltando.
--   * PARANÁ: a unidade atacadista de Curitiba fica em CURITIBA (bairro
--     Tatuquara), não em São José dos Pinhais.
--
-- Central inventada é DELETADA, não desativada. Ela não existe no mundo: deixá-la
-- inativa manteria um vínculo apontando para o nada. A FK `tenants.ceasaCentralCode`
-- é `ON DELETE SET NULL`, então qualquer empresa que tenha escolhido uma delas
-- volta a "sem central" e é convidada a escolher de novo — que é o desfecho
-- correto quando a opção anterior era falsa.
--
-- RESSALVA HONESTA: as demais unidades do catálogo (BA, PE, SP/CEAGESP, GO, MT,
-- MS, PA, PB, PI, RN, RS, e as capitais do Norte) seguem SEM verificação em
-- fonte oficial. São plausíveis, mas devem ser tratadas como rascunho até que
-- alguém confira. Corrigir qualquer uma é um UPDATE, não um deploy.

-- Unidades que não existem.
DELETE FROM "ceasa_centrals" WHERE "code" IN ('SCJOI', 'SCXAP', 'SCCCM', 'SCRSL', 'CESOB', 'RJCAM');

-- Cidade errada.
UPDATE "ceasa_centrals" SET "city" = 'Curitiba' WHERE "code" = 'PRCWB';

-- Unidades reais que faltavam.
INSERT INTO "ceasa_centrals" ("code", "name", "city", "uf", "sourceKey", "maxDiasSemBoletim", "sortOrder", "updatedAt") VALUES
  ('SCTUB', 'CEASA Santa Catarina — Tubarão',        'Tubarão',            'SC', 'manual', 7, 312, CURRENT_TIMESTAMP),
  ('RJSGO', 'CEASA-RJ São Gonçalo',                  'São Gonçalo',        'RJ', 'manual', 7, 261, CURRENT_TIMESTAMP),
  ('RJNFR', 'CEASA-RJ Região Serrana',               'Nova Friburgo',      'RJ', 'manual', 7, 262, CURRENT_TIMESTAMP),
  ('RJITA', 'CEASA-RJ Noroeste Fluminense',          'Itaocara',           'RJ', 'manual', 7, 263, CURRENT_TIMESTAMP),
  ('RJSJU', 'CEASA-RJ Norte Fluminense',             'São José de Ubá',    'RJ', 'manual', 7, 264, CURRENT_TIMESTAMP),
  ('RJPAT', 'CEASA-RJ Médio Paraíba',                'Paty do Alferes',    'RJ', 'manual', 7, 265, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
