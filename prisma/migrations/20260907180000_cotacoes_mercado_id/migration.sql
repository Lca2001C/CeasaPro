-- Corrige o identificador do mercado nas centrais da CEASAMINAS.
--
-- A migration anterior gravou `sourceParams = {"mercado":"CEAMG"}`, usando o
-- código do entreposto que aparece no nome da central. Ao medir o sistema real
-- (DetecWeb), o formulário revelou que o campo `mercado` é um SELECT de IDs
-- NUMÉRICOS — "Grande BH - CEAMG" tem value 214 — e que o parâmetro chega cru a
-- uma stored procedure de SQL Server.
--
-- Enviar "CEAMG" não devolveria erro visível: a procedure recebe a string, não
-- encontra mercado, e a página volta 200 sem nenhuma linha. Ou seja, o módulo
-- reportaria "dia sem boletim" todos os dias, para sempre, sem alarme nenhum —
-- exatamente o modo de falha silenciosa que o resto do desenho combate.
--
-- Os IDs foram lidos do `<select name="mercado">` da própria fonte.
--
-- `UPDATE` em vez de editar a migration anterior: ela já foi aplicada em banco
-- de desenvolvimento, e migration aplicada não se reescreve.

UPDATE "ceasa_centrals" SET "sourceParams" = '{"mercado":"214"}' WHERE "code" = 'CEAMG';
UPDATE "ceasa_centrals" SET "sourceParams" = '{"mercado":"217"}' WHERE "code" = 'CEARM';
UPDATE "ceasa_centrals" SET "sourceParams" = '{"mercado":"218"}' WHERE "code" = 'CEART';
UPDATE "ceasa_centrals" SET "sourceParams" = '{"mercado":"215"}' WHERE "code" = 'CEARG';
UPDATE "ceasa_centrals" SET "sourceParams" = '{"mercado":"260"}' WHERE "code" = 'CEARD';
UPDATE "ceasa_centrals" SET "sourceParams" = '{"mercado":"353"}' WHERE "code" = 'CEARB';
UPDATE "ceasa_centrals" SET "sourceParams" = '{"mercado":"237"}' WHERE "code" = 'CECAT';
