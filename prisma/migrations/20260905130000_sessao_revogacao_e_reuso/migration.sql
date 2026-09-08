-- Detecção de reuso de refresh token + revogação imediata de sessão.
--
-- 1) `refresh_tokens` ganha linhagem e MOTIVO da revogação.
--
-- `rotateRefreshToken` devolvia `null` para um token já revogado e os
-- chamadores só limpavam cookies — a família nunca era revogada. Quem copiasse
-- o cookie rotacionava uma vez e ficava com uma cadeia nova de 30 dias; a
-- vítima, ao voltar, apresentava o token que o atacante já queimou, recebia
-- `null` e era DESLOGADA. Nada era auditado.
--
-- O código já sabia da lacuna: `purgeDeadRefreshTokens` guarda as linhas
-- revogadas por 7 dias porque "a linha revogada é a evidência de reuso" — e
-- nenhum ponto do código consultava `revokedAt` para reagir.
--
-- `revokedReason` é o que torna a detecção possível sem falso positivo: hoje
-- `revokedAt != null` significa quatro coisas (rotação, logout, ação do admin,
-- troca de senha), e sem distingui-las todo logout viraria "ataque detectado".
ALTER TABLE "refresh_tokens" ADD COLUMN "familyId" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "replacedById" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "revokedReason" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "graceUses" INTEGER NOT NULL DEFAULT 0;

-- Linhas existentes viram cada uma a sua própria família: não há como
-- reconstruir a linhagem retroativamente, e uma família por token é a hipótese
-- conservadora (revoga o mínimo).
UPDATE "refresh_tokens" SET "familyId" = id WHERE "familyId" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "familyId" SET NOT NULL;

CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- 2) Contadores de revogação de sessão.
--
-- A sessão era 100% stateless na leitura: `getSession()` só verificava o JWT, e
-- nenhum wrapper revalidava contra o banco. Logout, exclusão de usuário,
-- desativação, bloqueio de empresa, chargeback e troca de senha mexiam SÓ em
-- `refresh_tokens` — o access token seguia autorizando escrita por até 15
-- minutos. A tela de redefinição promete o contrário ("todos os dispositivos
-- conectados serão desconectados").
--
-- Começam em 0 e vão no token como `sev`/`tev`; qualquer incremento invalida
-- as sessões emitidas antes. Sem backfill: 0 é o valor correto para todo mundo.
ALTER TABLE "users" ADD COLUMN "sessionEpoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tenants" ADD COLUMN "sessionEpoch" INTEGER NOT NULL DEFAULT 0;
