-- O cliente de praça manual passa a poder ENVIAR o boletim. Numa fila, não direto.
--
-- O problema de negócio
--
-- Das 66 praças do catálogo, 57 não têm raspador: o boletim delas só existe se
-- alguém colar em `/admin/cotacoes`. Isso põe o super-admin no caminho crítico de
-- um recurso que o cliente paga — ele precisa obter o boletim de uma praça que
-- não é dele, todos os dias, para cada cliente. Não escala, e quem fica sem preço
-- é justamente quem contratou.
--
-- Por que NÃO deixar o cliente gravar direto em `ceasa_quotes`
--
-- Essa era a saída óbvia e ela não se sustenta. Quatro razões medidas no código:
--
--   1. `CotacoesImportService.gravar` termina em `ON CONFLICT DO UPDATE`. É
--      primitiva de SOBRESCRITA: um cliente enviando a data que o super-admin já
--      colou apagaria o dado do super-admin.
--   2. `gravar` também escreve em `ceasa_products`, que é catálogo GLOBAL. Os
--      nomes que um cliente inventasse passariam a aparecer na tela de vínculo de
--      TODOS os clientes daquela praça.
--   3. `ceasa_quotes` é global: o preço que um cliente gravasse é o preço que os
--      concorrentes dele veem. É a única superfície do sistema em que um tenant
--      escreveria dado que outro tenant lê.
--   4. Os três alarmes são cegos a isso. `verificarDefasagem` exclui
--      `sourceKey = 'manual'`, e `conferirFingerprint` só roda a partir de
--      `importarCentral`. Nada dispararia.
--
-- E como toda leitura do cliente parte de `MAX(quoteDate)`, um dado ruim numa
-- praça manual é permanente por definição: só um boletim com data POSTERIOR o
-- superaria, e numa praça manual ele não vem sozinho.
--
-- O desenho
--
-- Esta tabela é RASCUNHO, e tem `tenantId`: o que o cliente envia é visível só
-- para ele até o super-admin publicar. Publicar chama o `gravar` que já existe,
-- do lado de dentro da fronteira de confiança que já existia. Recusar é apagar
-- uma linha, não reparar uma tabela global.
--
-- O valor original se mantém — o cliente não depende de ninguém transcrever o
-- boletim dele. O que sai é o tenant escrevendo em tabela compartilhada.
--
-- `textoCru` guarda o que foi colado, e não as linhas já parseadas, de propósito:
-- é o que permite ao super-admin ver o que o cliente realmente enviou quando o
-- parse discorda do esperado, e reprocessar sem pedir para colar de novo.

-- CreateEnum
CREATE TYPE "BoletimEnviadoStatus" AS ENUM ('PENDENTE', 'PUBLICADO', 'RECUSADO');

-- AlterEnum
-- Valor novo é apenas DECLARADO aqui: o Prisma roda cada migration numa
-- transação, e no Postgres um valor de enum criado dentro de uma transação não
-- pode ser USADO nela. Quem o usa é o código, depois.
ALTER TYPE "AdminNotificationKind" ADD VALUE IF NOT EXISTS 'COTACOES_ENVIO_CLIENTE';

CREATE TABLE "tenant_boletins_enviados" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "centralCode"     TEXT NOT NULL,
  "quoteDate"       DATE NOT NULL,
  "textoCru"        TEXT NOT NULL,
  "linhasValidas"   INTEGER NOT NULL DEFAULT 0,
  "linhasIgnoradas" INTEGER NOT NULL DEFAULT 0,
  "status"          "BoletimEnviadoStatus" NOT NULL DEFAULT 'PENDENTE',
  -- Por que foi recusado. O cliente tem direito de saber, senão ele reenvia o
  -- mesmo erro e a fila cresce sem ninguém entender por quê.
  "motivo"          TEXT,
  "revisadoPor"     TEXT,
  "revisadoEm"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_boletins_enviados_pkey" PRIMARY KEY ("id")
);

-- A fila do super-admin: pendentes primeiro, mais antigo antes.
CREATE INDEX "tenant_boletins_enviados_status_createdAt_idx"
  ON "tenant_boletins_enviados" ("status", "createdAt");

-- "O que EU enviei", na tela do cliente.
CREATE INDEX "tenant_boletins_enviados_tenantId_createdAt_idx"
  ON "tenant_boletins_enviados" ("tenantId", "createdAt");

-- Empresa excluída não deixa rascunho órfão na fila do operador.
ALTER TABLE "tenant_boletins_enviados"
  ADD CONSTRAINT "tenant_boletins_enviados_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE também na praça: central deletada do catálogo (a migration
-- 20260908090000 deletou quatro que não existiam no mundo) não deixa envio
-- apontando para o vazio.
ALTER TABLE "tenant_boletins_enviados"
  ADD CONSTRAINT "tenant_boletins_enviados_centralCode_fkey"
  FOREIGN KEY ("centralCode") REFERENCES "ceasa_centrals"("code") ON DELETE CASCADE ON UPDATE CASCADE;
