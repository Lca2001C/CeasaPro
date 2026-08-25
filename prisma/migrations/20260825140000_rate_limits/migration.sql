-- Contador de rate limit das rotas de autenticação.
--
-- Até aqui o limite vivia num Map em memória, o que só funcionava porque havia
-- uma única instância do servidor. Em serverless cada request pode cair numa
-- instância diferente, então o contador precisa ser compartilhado — e o
-- Postgres que a aplicação já usa resolve isso sem adicionar fornecedor.
--
-- Tabela nova e isolada: nenhuma tabela existente é tocada.

-- CreateTable
CREATE TABLE "rate_limits" (
    "keyHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("keyHash")
);

-- CreateIndex
CREATE INDEX "rate_limits_expiresAt_idx" ON "rate_limits"("expiresAt");
