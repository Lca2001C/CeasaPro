-- Uma conta ATIVA por caixa de e-mail (`emailIdentity`, a forma raiz do
-- endereço). A checagem `emailEmUso` sozinha não bastava: dois cadastros
-- simultâneos com `dono+1@` e `dono+2@` passavam os dois por ela antes de
-- qualquer um gravar, e cada um rendia um teste grátis.
--
-- Parcial porque o Prisma não declara índice com WHERE: conta excluída (que em
-- geral já tem a identidade nula) e conta sem identidade ficam de fora.

-- Duplicatas que já existam (fruto da mesma corrida) impediriam o índice: a
-- conta mais antiga fica com a identidade; as outras perdem a marca, continuam
-- existindo e entrando normalmente — só deixam de ser "a" dona do endereço.
UPDATE "users" u
SET "emailIdentity" = NULL
WHERE u."deletedAt" IS NULL
  AND u."emailIdentity" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "users" o
    WHERE o."emailIdentity" = u."emailIdentity"
      AND o."deletedAt" IS NULL
      AND (o."createdAt" < u."createdAt" OR (o."createdAt" = u."createdAt" AND o."id" < u."id"))
  );

CREATE UNIQUE INDEX "users_email_identity_ativa"
  ON "users"("emailIdentity")
  WHERE "deletedAt" IS NULL AND "emailIdentity" IS NOT NULL;
