-- Libera o e-mail de usuários JÁ excluídos antes da correção.
--
-- `users.email` é UNIQUE global e o índice não sabe o que é `deletedAt`: a
-- linha excluída seguia ocupando o endereço, e recadastrar a mesma pessoa
-- estourava violação de índice único — que chegava à tela como
-- "Ocorreu um erro inesperado (ref: ...)".
--
-- O carimbo mantém o e-mail original legível e garante unicidade pelo id.
-- Só toca em linha com `deletedAt` preenchido: conta ativa não é alterada.
-- Idempotente: quem já tem o prefixo é ignorado.

UPDATE "users"
SET "email" = 'excluido-' || "id" || '-' || "email"
WHERE "deletedAt" IS NOT NULL
  AND "email" NOT LIKE 'excluido-%';
