-- Catálogo nacional de CEASAs, UF da empresa, e cadência de boletim por central.
--
-- O cadastro passa a perguntar a UF e a central do CEASA, então a lista precisa
-- cobrir o Brasil, e não só Minas.
--
-- TRÊS COISAS AQUI VIERAM DE MEDIÇÃO CONTRA A FONTE REAL, não de suposição:
--
-- 1. O ESPÍRITO SANTO JÁ TEM DADO AUTOMÁTICO, sem adaptador novo. O host que já
--    usamos (minas1.ceasa.mg.gov.br) e o da CEASA-ES compartilham o mesmo banco:
--    um POST com `mercod=211` devolve "CEASA-ES UNID GRANDE VITORIA" com 152
--    produtos. Bastou acrescentar a central.
--
-- 2. POÇOS DE CALDAS (361) existe na fonte e não estava no catálogo. Não aparece
--    no formulário de Minas, mas responde com dado.
--
-- 3. A CADÊNCIA VARIA MUITO ENTRE UNIDADES. Medido em 8 dias úteis seguidos:
--       Grande BH e Grande Vitória ....... quase todo dia útil
--       Juiz de Fora, Barbacena,
--       Caratinga, Poços de Caldas ....... 2 a 3 vezes por semana
--       Uberaba .......................... nenhum boletim em 18 datas testadas
--    Por isso `maxDiasSemBoletim` é POR CENTRAL. Um limiar único de 3 dias faria
--    quatro unidades dispararem alarme de defasagem para sempre — e um alarme que
--    grita toda semana é ignorado em um mês, levando junto o alarme da quebra de
--    verdade, que é a única coisa que ele existia para pegar.
--
-- Uberaba fica como `manual` em vez de ser desativada: um boxeiro de Uberaba
-- precisa conseguir escolher a central dele. Como `manual`, ela aparece na lista,
-- a tela diz honestamente que ainda não há boletim, o cron NÃO tenta importar (e
-- portanto não alarma), e o super-admin pode colar um boletim quando quiser.
--
-- As demais centrais do país entram com `sourceKey = 'manual'` pelo mesmo motivo:
-- não temos raspador para elas, e prometer preço que não vem seria pior que
-- admitir que ainda não vem. Quando um adaptador novo for escrito, muda-se a
-- `sourceKey` da central — nada além disso.
--
-- A lista nacional cobre as unidades consolidadas de cada estado. Ela é do
-- operador: acrescentar, corrigir ou remover uma central é um UPDATE, não um
-- deploy.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "uf" CHAR(2);

-- AlterTable
ALTER TABLE "ceasa_centrals" ADD COLUMN "maxDiasSemBoletim" INTEGER NOT NULL DEFAULT 7;

-- As duas que publicam quase todo dia útil: 3 dias sem boletim já é sinal.
UPDATE "ceasa_centrals" SET "maxDiasSemBoletim" = 3 WHERE "code" = 'CEAMG';

-- Uberaba não devolveu boletim em nenhuma das 18 datas testadas.
UPDATE "ceasa_centrals" SET "sourceKey" = 'manual', "sourceParams" = NULL WHERE "code" = 'CEARG';

-- Centrais novas COM fonte automática (mesmo adaptador `ceasaminas`).
INSERT INTO "ceasa_centrals" ("code", "name", "city", "uf", "sourceKey", "sourceParams", "maxDiasSemBoletim", "sortOrder", "updatedAt") VALUES
  ('CEAES', 'CEASA-ES Grande Vitória',  'Cariacica',      'ES', 'ceasaminas', '{"mercado":"211"}', 3, 10, CURRENT_TIMESTAMP),
  ('CEAPC', 'CEASAMINAS Poços de Caldas','Poços de Caldas','MG', 'ceasaminas', '{"mercado":"361"}', 7,  8, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Catálogo nacional — sem fonte automática por enquanto.
INSERT INTO "ceasa_centrals" ("code", "name", "city", "uf", "sourceKey", "maxDiasSemBoletim", "sortOrder", "updatedAt") VALUES
  ('ACRBR', 'CEASA Acre',                        'Rio Branco',           'AC', 'manual', 7, 100, CURRENT_TIMESTAMP),
  ('ALMCZ', 'CEASA Alagoas',                     'Maceió',               'AL', 'manual', 7, 110, CURRENT_TIMESTAMP),
  ('AMMAO', 'CEASA Amazonas',                    'Manaus',               'AM', 'manual', 7, 120, CURRENT_TIMESTAMP),
  ('APMCP', 'CEASA Amapá',                       'Macapá',               'AP', 'manual', 7, 130, CURRENT_TIMESTAMP),
  ('BASSA', 'CEASA Bahia',                       'Simões Filho',         'BA', 'manual', 7, 140, CURRENT_TIMESTAMP),
  ('BAJUA', 'CEASA Juazeiro',                    'Juazeiro',             'BA', 'manual', 7, 141, CURRENT_TIMESTAMP),
  ('BAVDC', 'CEASA Vitória da Conquista',        'Vitória da Conquista', 'BA', 'manual', 7, 142, CURRENT_TIMESTAMP),
  ('CEFOR', 'CEASA Ceará',                       'Maracanaú',            'CE', 'manual', 7, 150, CURRENT_TIMESTAMP),
  ('CETIA', 'CEASA Tianguá',                     'Tianguá',              'CE', 'manual', 7, 151, CURRENT_TIMESTAMP),
  ('CEBAR', 'CEASA Cariri',                      'Barbalha',             'CE', 'manual', 7, 152, CURRENT_TIMESTAMP),
  ('CESOB', 'CEASA Sobral',                      'Sobral',               'CE', 'manual', 7, 153, CURRENT_TIMESTAMP),
  ('DFBSB', 'CEASA Distrito Federal',            'Brasília',             'DF', 'manual', 7, 160, CURRENT_TIMESTAMP),
  ('GOGYN', 'CEASA Goiás',                       'Goiânia',              'GO', 'manual', 7, 170, CURRENT_TIMESTAMP),
  ('MASLZ', 'CEASA Maranhão',                    'São Luís',             'MA', 'manual', 7, 180, CURRENT_TIMESTAMP),
  ('MSCGR', 'CEASA Mato Grosso do Sul',          'Campo Grande',         'MS', 'manual', 7, 190, CURRENT_TIMESTAMP),
  ('MTCGB', 'CEASA Mato Grosso',                 'Cuiabá',               'MT', 'manual', 7, 200, CURRENT_TIMESTAMP),
  ('PABEL', 'CEASA Pará',                        'Belém',                'PA', 'manual', 7, 210, CURRENT_TIMESTAMP),
  ('PBJPA', 'EMPASA João Pessoa',                'João Pessoa',          'PB', 'manual', 7, 220, CURRENT_TIMESTAMP),
  ('PBCGD', 'EMPASA Campina Grande',             'Campina Grande',       'PB', 'manual', 7, 221, CURRENT_TIMESTAMP),
  ('PEREC', 'CEASA Pernambuco',                  'Recife',               'PE', 'manual', 7, 230, CURRENT_TIMESTAMP),
  ('PECAR', 'CEASA Caruaru',                     'Caruaru',              'PE', 'manual', 7, 231, CURRENT_TIMESTAMP),
  ('PEPNZ', 'CEASA Petrolina',                   'Petrolina',            'PE', 'manual', 7, 232, CURRENT_TIMESTAMP),
  ('PITHE', 'CEASA Piauí',                       'Teresina',             'PI', 'manual', 7, 240, CURRENT_TIMESTAMP),
  ('PRCWB', 'CEASA Paraná — Curitiba',           'São José dos Pinhais', 'PR', 'manual', 7, 250, CURRENT_TIMESTAMP),
  ('PRLDB', 'CEASA Paraná — Londrina',           'Londrina',             'PR', 'manual', 7, 251, CURRENT_TIMESTAMP),
  ('PRMGF', 'CEASA Paraná — Maringá',            'Maringá',              'PR', 'manual', 7, 252, CURRENT_TIMESTAMP),
  ('PRCAC', 'CEASA Paraná — Cascavel',           'Cascavel',             'PR', 'manual', 7, 253, CURRENT_TIMESTAMP),
  ('PRIGU', 'CEASA Paraná — Foz do Iguaçu',      'Foz do Iguaçu',        'PR', 'manual', 7, 254, CURRENT_TIMESTAMP),
  ('RJRIO', 'CEASA-RJ Grande Rio',               'Rio de Janeiro',       'RJ', 'manual', 7, 260, CURRENT_TIMESTAMP),
  ('RJCAM', 'CEASA-RJ Campos',                   'Campos dos Goytacazes','RJ', 'manual', 7, 261, CURRENT_TIMESTAMP),
  ('RNNAT', 'CEASA Rio Grande do Norte',         'Natal',                'RN', 'manual', 7, 270, CURRENT_TIMESTAMP),
  ('RNMOS', 'CEASA Mossoró',                     'Mossoró',              'RN', 'manual', 7, 271, CURRENT_TIMESTAMP),
  ('ROPVH', 'CEASA Rondônia',                    'Porto Velho',          'RO', 'manual', 7, 280, CURRENT_TIMESTAMP),
  ('RRBVB', 'CEASA Roraima',                     'Boa Vista',            'RR', 'manual', 7, 290, CURRENT_TIMESTAMP),
  ('RSPOA', 'CEASA Rio Grande do Sul',           'Porto Alegre',         'RS', 'manual', 7, 300, CURRENT_TIMESTAMP),
  ('RSCXJ', 'CEASA Caxias do Sul',               'Caxias do Sul',        'RS', 'manual', 7, 301, CURRENT_TIMESTAMP),
  ('SCFLN', 'CEASA Santa Catarina — Grande Fpolis','São José',           'SC', 'manual', 7, 310, CURRENT_TIMESTAMP),
  ('SCBNU', 'CEASA Santa Catarina — Blumenau',   'Blumenau',             'SC', 'manual', 7, 311, CURRENT_TIMESTAMP),
  ('SCJOI', 'CEASA Santa Catarina — Joinville',  'Joinville',            'SC', 'manual', 7, 312, CURRENT_TIMESTAMP),
  ('SCXAP', 'CEASA Santa Catarina — Chapecó',    'Chapecó',              'SC', 'manual', 7, 313, CURRENT_TIMESTAMP),
  ('SCCCM', 'CEASA Santa Catarina — Criciúma',   'Criciúma',             'SC', 'manual', 7, 314, CURRENT_TIMESTAMP),
  ('SCRSL', 'CEASA Santa Catarina — Rio do Sul', 'Rio do Sul',           'SC', 'manual', 7, 315, CURRENT_TIMESTAMP),
  ('SEAJU', 'CEASA Sergipe',                     'Aracaju',              'SE', 'manual', 7, 320, CURRENT_TIMESTAMP),
  ('SPCEA', 'CEAGESP São Paulo',                 'São Paulo',            'SP', 'manual', 7, 330, CURRENT_TIMESTAMP),
  ('SPCPQ', 'CEASA Campinas',                    'Campinas',             'SP', 'manual', 7, 331, CURRENT_TIMESTAMP),
  ('SPRAO', 'CEAGESP Ribeirão Preto',            'Ribeirão Preto',       'SP', 'manual', 7, 332, CURRENT_TIMESTAMP),
  ('SPSJP', 'CEAGESP São José do Rio Preto',     'São José do Rio Preto','SP', 'manual', 7, 333, CURRENT_TIMESTAMP),
  ('SPSOD', 'CEAGESP Sorocaba',                  'Sorocaba',             'SP', 'manual', 7, 334, CURRENT_TIMESTAMP),
  ('SPBAU', 'CEAGESP Bauru',                     'Bauru',                'SP', 'manual', 7, 335, CURRENT_TIMESTAMP),
  ('SPPPB', 'CEAGESP Presidente Prudente',       'Presidente Prudente',  'SP', 'manual', 7, 336, CURRENT_TIMESTAMP),
  ('SPARU', 'CEAGESP Araçatuba',                 'Araçatuba',            'SP', 'manual', 7, 337, CURRENT_TIMESTAMP),
  ('SPMII', 'CEAGESP Marília',                   'Marília',              'SP', 'manual', 7, 338, CURRENT_TIMESTAMP),
  ('SPFRC', 'CEAGESP Franca',                    'Franca',               'SP', 'manual', 7, 339, CURRENT_TIMESTAMP),
  ('SPPCB', 'CEAGESP Piracicaba',                'Piracicaba',           'SP', 'manual', 7, 340, CURRENT_TIMESTAMP),
  ('SPAQA', 'CEAGESP Araraquara',                'Araraquara',           'SP', 'manual', 7, 341, CURRENT_TIMESTAMP),
  ('TOPMW', 'CEASA Tocantins',                   'Palmas',               'TO', 'manual', 7, 350, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
