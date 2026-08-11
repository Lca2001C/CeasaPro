# 7. Instalação e deploy

## Pré-requisitos

- **Node.js 20+**
- **Docker** (para o PostgreSQL local) — ou um PostgreSQL já instalado
- Para produção: contas em **Vercel**, **Neon** (Postgres), **Resend** (e-mail) e **Mercado Pago**

## Rodar localmente — jeito rápido (scripts)

Os scripts em [`scripts/`](../scripts/) fazem tudo: sobem o banco, instalam dependências, geram o Prisma, aplicam migrations, populam dados na 1ª vez e iniciam.

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1     # desenvolvimento
powershell -ExecutionPolicy Bypass -File scripts\start.ps1   # produção (build + start)
```
```bash
# Linux / macOS / Git Bash
bash scripts/dev.sh      # desenvolvimento
bash scripts/start.sh    # produção
```

> Não deixe dois servidores rodando ao mesmo tempo (no Windows, um `dev` aberto trava a geração do Prisma). Se `DATABASE_URL` apontar para um banco remoto, o passo do Docker é ignorado automaticamente.

## Rodar localmente — passo a passo (manual)

```bash
npm install                        # dependências (o postinstall já gera o Prisma Client)
cp .env.example .env               # configure as variáveis (veja abaixo)
docker compose up -d               # sobe o PostgreSQL local (container ceasapro-db)
npx prisma migrate dev             # cria as tabelas
npm run db:seed                    # super-admin + plano + empresa demo
npm run dev                        # http://localhost:3000
```

### Acessos criados pelo seed
- **Super-admin:** `admin@ceasapro.com.br` / valor de `SEED_SUPERADMIN_PASSWORD` (padrão `ceasapro123`)
- **Empresa demo** (se `SEED_DEMO=true`): `demo@ceasapro.com.br` / `demo123`

## Variáveis de ambiente

Arquivo modelo: [`.env.example`](../.env.example).

| Variável | Descrição |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | URL pública do app |
| `DATABASE_URL` | Postgres (em produção, a URL **pooled** do Neon) |
| `DIRECT_URL` | Conexão **direta** (usada em migrations) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Segredos dos tokens (32+ bytes) |
| `ACCESS_TOKEN_TTL` | Duração do access token (ex.: `15m`) |
| `REFRESH_TOKEN_TTL_DAYS` | Dias de validade do refresh token |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` | Credenciais do super-admin no seed |
| `SEED_DEMO` | `true` cria uma empresa de exemplo |
| `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` | Mercado Pago |
| `RESEND_API_KEY`, `EMAIL_FROM` | E-mail transacional |
| `CRON_SECRET` | Protege `/api/cron/billing` |
| `R2_*` | Cloudflare R2 (armazenamento — logo/anexos, futuro) |

Gere segredos com: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` ou `openssl rand -base64 32`.

## Deploy de baixo custo (Vercel + Neon + Resend)

1. **Banco (Neon):** crie um projeto Postgres. Copie a *connection string* **pooled** para `DATABASE_URL` e a **direct** para `DIRECT_URL`.
2. **Vercel:** importe o repositório. Configure **todas** as variáveis do `.env.example` em *Production* (e *Preview*).
3. **Migrations em produção:** rode `npm run prisma:deploy` (`prisma migrate deploy`, usa `DIRECT_URL`) no pipeline de release — **nunca** `migrate dev` em produção.
4. **Seed inicial** (uma vez), apontando para o banco de produção, com `SEED_SUPERADMIN_*` definidos.
5. **Mercado Pago:** configure `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`; no painel do Mercado Pago aponte o webhook para `https://SEU_DOMINIO/api/webhooks/mercadopago`.
6. **Cron:** o [`vercel.json`](../vercel.json) já agenda `/api/cron/billing` diariamente (protegido por `CRON_SECRET`).
7. **E-mail:** verifique o domínio no Resend e configure `RESEND_API_KEY`/`EMAIL_FROM`.

> O `build` roda `prisma generate` antes do `next build` (necessário na Vercel).

## Backup

- **Neon:** ative o *backup automático diário* e o *point-in-time restore*.
- **Exportação mensal:** agende um `pg_dump` e envie o arquivo para um storage frio (Cloudflare R2 / S3).

## Observações da versão atual

- **Relatórios**: exportação em **Excel (.xlsx)** e **impressão / salvar como PDF** pelo navegador.
- **Prisma** fixado na **v6** de propósito (a v7 exige `prisma.config.ts` + driver adapters).
- No Windows/OneDrive, feche servidores antes de builds para evitar bloqueio de arquivo do Prisma; se ocorrer `EPERM`, feche o `dev` e rode `npx prisma generate`.
