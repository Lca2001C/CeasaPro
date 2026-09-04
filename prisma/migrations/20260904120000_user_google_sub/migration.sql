-- Login com Google: o `sub` do OpenID é o identificador estável da conta.
-- Nulo nas contas que só entram com e-mail e senha.

ALTER TABLE "users" ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");
