# 7. Instalação e deploy

## Pré-requisitos

- **Node.js 22+**
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
| `JWT_SECRET` | Segredo do access token (32+ bytes) |
| `ACCESS_TOKEN_TTL` | Duração do access token (ex.: `15m`) |
| `REFRESH_TOKEN_TTL_DAYS` | Dias de validade do refresh token |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` | Credenciais do super-admin no seed |
| `SEED_DEMO` | `true` cria uma empresa de exemplo |
| `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | Mercado Pago |
| `RESEND_API_KEY`, `EMAIL_FROM` | E-mail transacional |
| `CRON_SECRET` | Protege `/api/cron/billing` |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | WhatsApp do suporte (só dígitos, com DDI) |
| `R2_*` | Cloudflare R2 (armazenamento — logo/anexos, futuro) |

Gere segredos com: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` ou `openssl rand -base64 32`.

## Deploy de baixo custo (Vercel + Neon + Resend)

O procedimento **completo** (contas, variáveis, migrations, seed, webhook, cron, domínio e troubleshooting) está em:

**[09 — Deploy em produção (Vercel + Neon)](09-deploy-vercel.md)**

Resumo: app na Vercel + Postgres no Neon. As migrations entram pelo job de deploy do GitHub Actions (`PROD_DIRECT_URL`); seed uma vez com `SEED_DEMO=false`; webhook em `https://SEU-DOMINIO/api/webhooks/mercadopago`.

## Backup

- **Neon:** ative o *backup automático diário* e o *point-in-time restore*.
- **Exportação mensal:** agende um `pg_dump` e envie o arquivo para um storage frio (Cloudflare R2 / S3).

## Observações da versão atual

- **Relatórios**: exportação em **Excel (.xlsx)** e **impressão / salvar como PDF** pelo navegador.
- **Prisma** fixado na **v6** de propósito (a v7 exige `prisma.config.ts` + driver adapters).
- No Windows/OneDrive, feche servidores antes de builds para evitar bloqueio de arquivo do Prisma; se ocorrer `EPERM`, feche o `dev` e rode `npx prisma generate`.
