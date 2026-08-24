-- Índice para o fluxo "esqueci minha senha".
--
-- `/api/auth/reset` e a página /recuperar-senha/[token] buscam o usuário pelo
-- SHA-256 do token. Sem índice, cada clique em link de redefinição (e cada bot
-- varrendo a rota) faz um seq scan em "users".
--
-- Índice simples (não parcial) de propósito: é exatamente o que o
-- `@@index([resetTokenHash])` do schema.prisma gera, então `prisma migrate dev`
-- não acusa drift no futuro.

-- CreateIndex
CREATE INDEX "users_resetTokenHash_idx" ON "users"("resetTokenHash");
