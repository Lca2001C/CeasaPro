# 9. Deploy em produção — Vercel e Render

Guia passo a passo para colocar o CeasaPro no ar. Siga na ordem: as etapas de **contas e segredos** são comuns; depois escolha **uma** plataforma para o app (**Vercel** *ou* **Render**).

> Não misture as duas para o mesmo ambiente (dois apps apontando para o mesmo banco e os mesmos webhooks do Mercado Pago). Escolha uma, complete o go-live e só então experimente a outra num projeto separado.

Documento irmão: instalação local em [`07-instalacao-e-deploy.md`](07-instalacao-e-deploy.md). Variáveis em [`.env.example`](../.env.example).

---

## 0. Qual plataforma usar?

| | **Vercel + Neon** (recomendado) | **Render** (app + Postgres juntos) |
|---|---|---|
| App | Serverless (Next.js nativo) | Processo Node 24h (`next start`) |
| Banco | Neon (há região em **São Paulo**) | Postgres do próprio Render (EUA/Europa) |
| Cron de cobrança | Já agendado em `vercel.json` (06:00 UTC) | Cron Job no Blueprint (`render.yaml`) |
| Latência no Brasil | Melhor (`gru1` + Neon `sa-east-1`) | Pior (Oregon/Frankfurt) |
| Custo inicial | Hobby da Vercel + Neon Free/Launch | Starter do web + Postgres básico (não use o free: **dorme** e quebra PIX/webhook) |
| Quando escolher | Produção real, clientes no CEASA | Quer um único painel e servidor sempre ligado |

Arquivos que o deploy usa:

- [`vercel.json`](../vercel.json) — região `gru1` e cron `/api/cron/billing`
- [`render.yaml`](../render.yaml) — web + Postgres 16 + cron
- [`package.json`](../package.json) — `build` gera o Prisma Client; `start` escuta em `0.0.0.0` (Render injeta `PORT`)
- `GET /api/health` — probe do Render (não consulta o banco)

---

## 1. Antes de qualquer deploy (checklist)

### 1.1 Contas

Crie (e confirme o e-mail) nestes serviços:

1. **GitHub** — o código precisa estar num repositório (público ou privado).
2. **Mercado Pago** — conta de **produção** (não a de teste), com aplicação criada em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app).
3. **Resend** — para e-mail de recuperação de senha e avisos. Verifique um **domínio próprio** (não envie pelo `*.resend.dev` em produção).
4. Conforme a escolha do app:
   - Vercel: conta em [vercel.com](https://vercel.com) **e** banco em [neon.tech](https://neon.tech)
   - Render: conta em [render.com](https://render.com) (o Postgres nasce no Blueprint)

### 1.2 Código no GitHub

Na sua máquina, na raiz do projeto:

```bash
git status
git add -A
git commit -m "Prepare o CeasaPro para produção"
git push origin main
```

O deploy das duas plataformas lê o branch `main`. Confirme que `.env` **não** entra no Git (já está no `.gitignore`).

### 1.3 Gere os segredos (guarde num bloco de notas seguro)

No terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Rode **três vezes** e anote com rótulo:

| Rótulo | Uso |
|---|---|
| `JWT_SECRET` | Assina o cookie de sessão (mínimo 32 caracteres) |
| `CRON_SECRET` | Bearer que protege `POST /api/cron/billing` |
| `SEED_SUPERADMIN_PASSWORD` | Senha inicial do super-admin (troque no primeiro login) |

Do Mercado Pago (aplicação de **produção**, prefixo `APP_USR-`):

| Variável | Onde copiar |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Credenciais de produção → Access Token |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | Credenciais de produção → Public Key |
| `MERCADOPAGO_WEBHOOK_SECRET` | Webhooks → chave secreta (depois de cadastrar a URL; veja a seção 5) |

Do Resend:

| Variável | Exemplo |
|---|---|
| `RESEND_API_KEY` | começa com `re_` |
| `EMAIL_FROM` | `CeasaPro <nao-responda@seudominio.com.br>` (o domínio precisa estar verificado) |

WhatsApp de suporte (só dígitos, com DDI):

| Variável | Exemplo |
|---|---|
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | `5531999990000` (12 ou 13 dígitos) |

> Variáveis `NEXT_PUBLIC_*` entram no **JavaScript do browser na hora do build**. Se você mudar a public key ou o WhatsApp depois, **obrigatório rebuild** (não basta alterar o env e reiniciar).

### 1.4 O que **não** fazer em produção

- Não use `SEED_DEMO=true` (cria empresa de exemplo com senha fraca).
- Não rode `npx prisma migrate dev` contra o banco de produção (só `npm run prisma:deploy`).
- Não aponte o webhook do Mercado Pago para `localhost`.
- Não reutilize token de **teste** (`TEST-`) no ar.

---

## 2. Banco de dados

O Prisma usa **duas** URLs:

- `DATABASE_URL` — conexões da aplicação (pode ser *pooled*)
- `DIRECT_URL` — migrations (`prisma migrate deploy`)

### 2.1 Neon (para Vercel) — passo a passo

1. Acesse [console.neon.tech](https://console.neon.tech) → **New Project**.
2. Name: `ceasapro`. Region: **São Paulo (sa-east-1)** se aparecer na lista; senão a mais próxima da América do Sul.
3. Postgres 16. Crie o projeto.
4. Em **Dashboard → Connection details**:
   - Copie a string **Pooled** (host contém `-pooler`).
   - Copie a string **Direct** (host **sem** `-pooler`).
5. Monte as variáveis:

```
DATABASE_URL="postgresql://USER:SENHA@HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://USER:SENHA@HOST.REGION.aws.neon.tech/neondb?sslmode=require"
```

O `pgbouncer=true` e o `connection_limit=1` são **obrigatórios** na Vercel (cada função serverless abre poucas conexões; sem isso o Neon esgota o limite).

6. Opcional: em **Settings → Backup**, ative PITR / backup automático no plano que você contratar.

Ainda **não** rode o seed. Primeiro o app precisa existir para você ter a URL pública (`https://….vercel.app`).

### 2.2 Postgres do Render

Se for deploys pelo Blueprint (`render.yaml`), o banco `ceasapro-db` é criado automaticamente e as URLs são injetadas. Pule para a [seção 4](#4-deploy-no-render).

Se criar o banco na mão: **New → PostgreSQL** → nome `ceasapro-db` → Postgres 16 → plano **Basic** (não Free). Depois copie **Internal Database URL** para `DATABASE_URL` e `DIRECT_URL` (as duas iguais). Se o Prisma falhar com SSL, acrescente `?sslmode=require`.

---

## 3. Deploy na Vercel

### 3.1 Importar o projeto

1. [vercel.com/new](https://vercel.com/new) → Continue with GitHub → autorize e escolha o repositório **CeasaPro**.
2. Framework Preset: **Next.js** (detecta sozinho).
3. Root Directory: `.` (raiz).
4. Node.js: o repositório declara `22` em `.node-version` e `engines`. Confira em **Settings → Build and Deployment → Node.js Version** = **22.x**.
5. **Ainda não clique em Deploy.** Abra **Environment Variables**.

### 3.2 Variáveis de ambiente

Cadastre **uma a uma**, marcando **Production** (e Preview se quiser). Valores `NEXT_PUBLIC_*` precisam existir **antes do primeiro build**.

Cole a URL temporária da Vercel quando o projeto já tiver um nome (ex.: `https://ceasapro.vercel.app`). Se ainda não souber, use um placeholder `https://ceasapro.vercel.app` e ajuste + faça Redeploy depois.

| Variável | Valor | Production | Preview |
|---|---|---|---|
| `NODE_ENV` | `production` | sim | sim |
| `APP_URL` | `https://SEU-PROJETO.vercel.app` (depois o domínio customizado) | sim | URL do preview, se usar |
| `NEXT_PUBLIC_APP_URL` | **igual** a `APP_URL` | sim | sim |
| `DATABASE_URL` | Neon pooled (`pgbouncer=true&connection_limit=1`) | sim | sim (ou um branch Neon de preview) |
| `DIRECT_URL` | Neon direct | sim | sim |
| `JWT_SECRET` | gerado na seção 1.3 | sim | sim (pode ser outro) |
| `ACCESS_TOKEN_TTL` | `15m` | sim | sim |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | sim | sim |
| `SEED_SUPERADMIN_EMAIL` | `admin@ceasapro.com.br` | sim | — |
| `SEED_SUPERADMIN_PASSWORD` | senha forte | sim | — |
| `SEED_DEMO` | `false` | sim | `false` |
| `MERCADOPAGO_ACCESS_TOKEN` | `APP_USR-…` | sim | não (ou credencial de teste) |
| `MERCADOPAGO_WEBHOOK_SECRET` | chave do painel MP | sim | — |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | `APP_USR-…` (public key) | sim | sim |
| `RESEND_API_KEY` | `re_…` | sim | opcional |
| `EMAIL_FROM` | `CeasaPro <nao-responda@seudominio.com.br>` | sim | opcional |
| `CRON_SECRET` | gerado na seção 1.3 | sim | sim |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | só dígitos com DDI | sim | opcional |

Não copie nomes antigos (`MP_ACCESS_TOKEN`, `JWT_ACCESS_SECRET`, `NEXT_PUBLIC_MP_PUBLIC_KEY`).

### 3.3 Build Command (migrations)

Em **Settings → General → Build & Development Settings**:

- **Build Command:** `npx prisma migrate deploy && npm run build`
- **Install Command:** `npm ci` (padrão)
- **Output:** deixe o padrão do Next.js

Assim cada deploy aplica migrations **antes** de gerar o site. `migrate deploy` é idempotente (não recria o que já existe) e **nunca** gera migration nova — isso só o `migrate dev` local faz.

### 3.4 Primeiro deploy

1. **Deploy**.
2. Espere o build (Prisma generate + migrate + Next). Se falhar, abra os logs:
   - `Can't reach database` → `DATABASE_URL`/`DIRECT_URL` erradas ou IP não liberado (Neon libera `0.0.0.0/0` por padrão; confira **IP Allow**.
   - `P1001` / SSL → falta `sslmode=require`.
   - `Environment variable not found: DIRECT_URL` → variável não marcada para Production.
3. Abra `https://SEU-PROJETO.vercel.app/api/health` — deve devolver `{"ok":true,"service":"ceasapro"}`.
4. Abra `/login` — a tela carrega (ainda sem usuário até o seed).

### 3.5 Seed do super-admin (uma vez)

Na sua máquina, **sem** commitar `.env`, aponte temporariamente para o Neon e rode:

```bash
# PowerShell — só nesta janela
$env:DATABASE_URL="postgresql://…direct…?sslmode=require"
$env:DIRECT_URL="$env:DATABASE_URL"
$env:SEED_SUPERADMIN_EMAIL="admin@ceasapro.com.br"
$env:SEED_SUPERADMIN_PASSWORD="a-senha-forte-que-você-escolheu"
$env:SEED_DEMO="false"
npx prisma migrate deploy   # segurança: confirma que as tabelas existem
npm run db:seed
```

```bash
# bash
export DATABASE_URL="postgresql://…direct…?sslmode=require"
export DIRECT_URL="$DATABASE_URL"
export SEED_SUPERADMIN_EMAIL="admin@ceasapro.com.br"
export SEED_SUPERADMIN_PASSWORD="a-senha-forte-que-voce-escolheu"
export SEED_DEMO="false"
npx prisma migrate deploy
npm run db:seed
```

Saída esperada: `✔ Super-admin criado` e os planos **Padrão** e **Básico**. Se aparecer `• Super-admin já existe`, o seed é idempotente — não duplica.

Entre em `https://SEU-PROJETO.vercel.app/login`, use o e-mail/senha do super-admin e **troque a senha** na tela obrigatória.

### 3.6 Domínio próprio (Vercel)

1. **Settings → Domains → Add** → `app.seudominio.com.br` (ou o raiz).
2. No DNS do registrador, crie o registro que a Vercel mostrar (`CNAME` para `cname.vercel-dns.com` ou `A`).
3. Espere o certificado TLS (alguns minutos).
4. **Atualize** `APP_URL` e `NEXT_PUBLIC_APP_URL` para `https://app.seudominio.com.br`.
5. **Deployments → … → Redeploy** o deployment de produção (as `NEXT_PUBLIC_*` só mudam no rebuild).
6. Siga a [seção 5](#5-depois-que-o-site-está-no-ar) com essa URL definitiva.

### 3.7 Cron na Vercel

O arquivo `vercel.json` já agenda:

```
GET /api/cron/billing   todos os dias às 06:00 UTC  (03:00 em Brasília)
```

A Vercel envia automaticamente `Authorization: Bearer $CRON_SECRET` quando a variável existe. Confira em **Settings → Cron Jobs**.

Hobby: crons no máximo 1× por dia — este agendamento cabe. Pro: pode aumentar a frequência depois.

Teste manual:

```bash
curl -X POST "https://SEU-DOMINIO/api/cron/billing" -H "Authorization: Bearer SEU_CRON_SECRET"
```

Resposta `{"ok":true,...}`. Sem o header → `401 unauthorized`.

### 3.8 GitHub Actions (opcional)

O workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) já faz lint, testes, preflight, build e (se houver secrets) migrate + deploy.

Secrets do repositório (**Settings → Secrets and variables → Actions**):

| Secret | Para quê |
|---|---|
| `VERCEL_TOKEN` | Token em vercel.com → Settings → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` depois de `npx vercel link` |
| `VERCEL_PROJECT_ID` | idem |
| `PROD_DIRECT_URL` | a `DIRECT_URL` de produção (migrations no CI) |

Sem esses secrets o job de deploy **é ignorado** e vale a integração Git da Vercel (cada push em `main` publica). As duas formas não precisam coexistir.

---

## 4. Deploy no Render

O repositório traz [`render.yaml`](../render.yaml): um **Web Service**, um **Postgres 16** e um **Cron Job** (billing às 06:00 UTC).

### 4.1 Aplicar o Blueprint

1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**.
2. Conecte o GitHub e selecione o repositório CeasaPro, branch `main`.
3. Render lê `render.yaml`. Confira os nomes `ceasapro`, `ceasapro-db`, `ceasapro-billing-cron`.
4. Preencha **todas** as variáveis `sync: false` (o painel pede uma a uma):

| Variável | Valor |
|---|---|
| `APP_URL` | deixe `https://ceasapro.onrender.com` por agora (ajuste depois com o hostname real) |
| `NEXT_PUBLIC_APP_URL` | igual a `APP_URL` |
| `SEED_SUPERADMIN_EMAIL` | `admin@ceasapro.com.br` |
| `SEED_SUPERADMIN_PASSWORD` | senha forte |
| `MERCADOPAGO_ACCESS_TOKEN` | `APP_USR-…` |
| `MERCADOPAGO_WEBHOOK_SECRET` | chave do painel (pode colar um placeholder e atualizar na seção 5) |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | public key `APP_USR-…` |
| `RESEND_API_KEY` | `re_…` |
| `EMAIL_FROM` | `CeasaPro <nao-responda@seudominio.com.br>` |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | `5531…` |

`JWT_SECRET` e `CRON_SECRET` o Blueprint **gera sozinho**. `DATABASE_URL` e `DIRECT_URL` vêm do Postgres.

5. **Apply**. O primeiro deploy demora vários minutos (install + migrate + `next build`).

### 4.2 Conferir o Web Service

1. Abra o serviço **ceasapro** → copie a URL `https://ceasapro-XXXX.onrender.com`.
2. Se for diferente do `APP_URL` que você preencheu:
   - **Environment** → edite `APP_URL` e `NEXT_PUBLIC_APP_URL` para a URL real (https).
   - **Manual Deploy → Deploy latest commit** (rebuild obrigatório por causa do `NEXT_PUBLIC_*`).
3. Abra `https://SUA-URL.onrender.com/api/health` → `{"ok":true,"service":"ceasapro"}`.
4. Logs: **Logs**. Erro `Can't reach database server` no migrate → o build precisa da URL **interna** (o Blueprint já injeta). Não troque pela External URL no web service.

Planos: o YAML usa **starter** no web e **basic-256mb** no Postgres. O plano **free** do web **adormece**; webhook do Mercado Pago e PIX falham com 503. Não use free em produção.

### 4.3 Seed no Render

Opção A — **Shell** do próprio serviço (se o plano oferecer):

```bash
export SEED_DEMO=false
npx tsx prisma/seed.ts
```

Se `tsx` não estiver instalado no runtime de produção:

```bash
npx --yes tsx prisma/seed.ts
```

Opção B — da sua máquina, usando a **External Database URL** do Postgres (Dashboard do banco → Connections → External):

```bash
export DATABASE_URL="postgresql://…render.com/ceasapro?sslmode=require"
export DIRECT_URL="$DATABASE_URL"
export SEED_SUPERADMIN_EMAIL="admin@ceasapro.com.br"
export SEED_SUPERADMIN_PASSWORD="sua-senha"
export SEED_DEMO="false"
npm run db:seed
```

Faça login em `/login` e troque a senha.

### 4.4 Cron Job no Render

O serviço `ceasapro-billing-cron` roda `node scripts/run-billing-cron.mjs` (`npm run cron:billing`). Ele chama `POST $APP_URL/api/cron/billing` com o mesmo `CRON_SECRET` do web.

1. Abra o cron → **Environment**: `APP_URL` tem que ser a URL **pública https** do web (não `localhost`).
2. **Trigger Run** uma vez e leia os logs. Sucesso = JSON `ok: true`.
3. Agenda: `0 6 * * *` (06:00 UTC).

### 4.5 Domínio próprio (Render)

1. Web service → **Settings → Custom Domains → Add** `app.seudominio.com.br`.
2. No DNS, `CNAME` para o hostname que o Render mostrar.
3. Atualize `APP_URL` e `NEXT_PUBLIC_APP_URL` **e o `APP_URL` do cron** → redeploy do web.

### 4.6 Criar na mão (sem Blueprint)

Se preferir o painel:

1. **New → PostgreSQL** → `ceasapro-db` → 16 → Basic.
2. **New → Web Service** → repo GitHub → Node.
   - **Build Command:** `npm ci && npx prisma generate && npx prisma migrate deploy && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
   - **Instance:** Starter, Node 22
3. Cole as variáveis da tabela da seção 3.2. `DATABASE_URL` e `DIRECT_URL` = Internal Database URL.
4. **New → Cron Job** → mesmo repo.
   - **Schedule:** `0 6 * * *`
   - **Build Command:** `echo ok`
   - **Command:** `node scripts/run-billing-cron.mjs`
   - Env: `APP_URL`, `CRON_SECRET` (o mesmo do web).

---

## 5. Depois que o site está no ar

Use a URL **final** (domínio próprio se já configurou). Troque `https://SEU-DOMINIO` abaixo.

### 5.1 Mercado Pago — webhook

1. [Painel de desenvolvedores](https://www.mercadopago.com.br/developers/panel/app) → sua aplicação de produção.
2. **Webhooks** → URL:

```
https://SEU-DOMINIO/api/webhooks/mercadopago
```

3. Evento: **Pagamentos** (`payment`).
4. Copie a **chave secreta** → variável `MERCADOPAGO_WEBHOOK_SECRET` na Vercel/Render.
5. Se o secret mudou, **não** precisa rebuild (não é `NEXT_PUBLIC_*`); na Vercel um Redeploy rápido basta para recarregar env do server; no Render, **Restart**.
6. Teste: gere um PIX de teste na tela `/assinatura` (com uma empresa real). O status deve ir para pago sem você recarregar à força — o cron também reconcilia no dia seguinte se o webhook falhar.

### 5.2 Resend — e-mail do "esqueci minha senha"

Sem esta configuração o botão **Esqueci minha senha** funciona na tela mas **nenhum e-mail sai**: a API responde a mesma mensagem genérica sempre (para não revelar quais e-mails existem), então o usuário não vê erro nenhum. Configure antes do go-live.

**1) Verifique o domínio no Resend**

1. Resend → **Domains → Add** o domínio que está em `EMAIL_FROM`.
2. Crie os registros DNS (SPF, DKIM e, de preferência, DMARC) e espere ficar **Verified**.
3. `EMAIL_FROM` tem que ser **do domínio verificado**. Enviar de `@gmail.com` ou do `*.resend.dev` em produção cai em spam ou é recusado.

**2) Variáveis no Render** (Web Service → *Environment*)

| Variável | Obrigatória | Observação |
|---|---|---|
| `RESEND_API_KEY` | sim | começa com `re_`; sem ela o envio é **no-op silencioso** |
| `EMAIL_FROM` | sim | `CeasaPro <nao-responda@seudominio.com.br>` |
| `APP_URL` | sim | origem do link do e-mail: `https://`, sem barra no fim |
| `EMAIL_REPLY_TO` | não | endereço de resposta monitorado; melhora a reputação anti-spam |
| `RESEND_WEBHOOK_SECRET` | não | só se cadastrar o webhook de bounce/spam |

> Se `APP_URL` faltar, o servidor cai em `RENDER_EXTERNAL_URL` (o Render injeta sozinho) e o link ainda sai com `https://SEU-SERVICO.onrender.com` — é rede de segurança, não substituto: com domínio próprio o link sairia com o endereço errado.

**3) Webhook (opcional)** — Resend → **Webhooks** → `https://SEU-DOMINIO/api/webhooks/resend`; guarde o segredo em `RESEND_WEBHOOK_SECRET`.

**4) Teste em produção**

1. `/login` → **Esqueci minha senha** → e-mail do super-admin.
2. A tela responde "Verifique seu e-mail" (responde isso **mesmo se o e-mail não existir** — é proposital).
3. O e-mail chega em segundos; em Resend → **Emails** o status fica `delivered`.
4. Abra o link. A tela valida o token **no servidor** antes de pedir a senha: link velho mostra "Link inválido ou expirado" em vez de deixar digitar à toa.
5. Defina a senha nova → entre com ela. A antiga para de funcionar e todas as sessões abertas caem.

**Como o fluxo funciona** (útil para depurar)

| Etapa | Onde |
|---|---|
| Formulário do pedido | `/recuperar-senha` |
| Gera o token e dispara o e-mail | `POST /api/auth/forgot` |
| Token: 32 bytes aleatórios; o banco guarda só o SHA-256 | `users.resetTokenHash` |
| Validade | 1 hora, **uso único** (pedir outro link invalida o anterior) |
| Tela do link | `/recuperar-senha/[token]` |
| Grava a senha nova e revoga as sessões | `POST /api/auth/reset` |
| Limites | 5 pedidos / 15 min por IP e 3 / 15 min por e-mail (contador em memória: valem **por instância**) |
| Trilha de auditoria | `audit_logs`: `PASSWORD_RESET_REQUESTED` e `PASSWORD_RESET` |

Depois da troca o usuário recebe um segundo e-mail ("Sua senha foi alterada") — é o aviso que permite reagir se não tiver sido ele.

Em **desenvolvimento**, sem `RESEND_API_KEY`, nada é enviado: o link aparece no log do servidor como `[DEV] Link de redefinição de senha`, o que permite testar o fluxo inteiro sem caixa de e-mail.

### 5.3 Pré-flight contra produção

Na sua máquina, com as URLs **direct** do banco de produção:

```bash
export NODE_ENV=production
export DATABASE_URL="…"
export DIRECT_URL="…"
# cole também JWT_SECRET, APP_URL, NEXT_PUBLIC_APP_URL, tokens MP, Resend, CRON_SECRET, WhatsApp
npm run preflight
```

Só siga se a saída for **Tudo certo. Pronto para o deploy.** Avisos de variável antiga (`MP_*`, `JWT_ACCESS_SECRET`) significam que alguém ainda configurou o nome velho — apague no painel.

### 5.4 Checklist de fumaça (15 minutos)

- [ ] `GET /api/health` → 200
- [ ] `/termos` e `/privacidade` abrem **sem** login
- [ ] Login super-admin → troca de senha obrigatória → `/admin`
- [ ] Admin → **Planos**: Padrão e Básico ativos, preços corretos
- [ ] Admin → **Clientes → Novo**: cria empresa (nasce **suspensa** até pagar)
- [ ] Como OWNER: `/assinatura` mostra PIX e, se a public key estiver no build, o Payment Brick
- [ ] Pagamento de teste/produção aprovado → empresa **ATIVA** → `/dashboard`
- [ ] Webhook MP: no painel, último envio **2xx**
- [ ] Cron: execução manual devolve `ok: true`
- [ ] **Esqueci minha senha**: e-mail chega, link abre, senha nova entra e a antiga para de funcionar
- [ ] Link de redefinição já usado (ou de mais de 1 h) mostra "Link inválido ou expirado"
- [ ] Botão de WhatsApp aparece (se `NEXT_PUBLIC_SUPPORT_WHATSAPP` estava no **build**)
- [ ] HTTPS no domínio; cookie de sessão persiste (não desloga no F5)

### 5.5 DNS, HTTPS e cookies

O app marca o cookie `Secure` quando o proxy manda `x-forwarded-proto: https` (Vercel e Render fazem isso). Se o domínio customizado ficar em HTTP ou num redirect mal configurado, o login “não pega”. Sempre acesse pelo `https://`.

---

## 6. Operação no dia a dia

### Deploys seguintes

- Push em `main` → Vercel e/ou Render constroem de novo.
- Toda migration nova em `prisma/migrations/` entra no ar no `prisma migrate deploy` do build. **Nunca** edite uma migration já aplicada em produção; crie outra.
- Mudança em `NEXT_PUBLIC_*` → precisa de build novo, não só restart.

### Logs

- Vercel: deployment → **Runtime Logs** / **Logs**.
- Render: serviço → **Logs**.
- Não devem aparecer senha, token ou payload de cartão (o logger redige esses campos).

### Backup

- **Neon:** backup / PITR no plano contratado + um `pg_dump` mensal para R2/S3.
- **Render Postgres:** backups automáticos no plano pago; mesmo assim faça `pg_dump` periódico pela External URL.

```bash
pg_dump "$DIRECT_URL" -Fc -f ceasapro-$(date +%Y%m%d).dump
```

### Rollback

- Vercel: **Deployments → Promote** um deployment anterior (o banco **não** volta; migrations Prisma são só para frente).
- Render: **Manual Deploy** de um commit anterior. Se a migration nova já rodou, o schema antigo do código pode quebrar — reverse com uma migration nova, não “desaplique”.

### Suspender o ar

- Vercel: **Settings → Pause project** (plano adequado) ou proteja com senha.
- Render: **Suspend** no serviço. Lembre de suspender o cron também.

---

## 7. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Build: `Environment variable not found: DATABASE_URL` | Env não marcada para Production | Recrie a variável no painel e redeploy |
| Build: `P3005` / banco não vazio sem `_prisma_migrations` | Banco criado na mão com SQL solto | Use um banco vazio ou `prisma migrate resolve` com cuidado |
| Site no ar mas login não grava sessão | `APP_URL` em http, ou acessando pelo endereço errado | `https://` no `APP_URL`; um único domínio canônico |
| Tela de assinatura só PIX, sem cartão | Faltou `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` **no build** | Setar e **rebuild** |
| Pagou no MP e continua suspenso | Webhook 401/404 ou URL antiga | Confira a URL `/api/webhooks/mercadopago`, o secret, e rode o cron |
| Cron 401 | `CRON_SECRET` diferente do que o job envia | Vercel: a variável tem que se chamar exatamente `CRON_SECRET`. Render: o job precisa da mesma string do web |
| Build Vercel reclama de `gru1` | Região São Paulo indisponível no plano | Em `vercel.json`, troque `"regions"` por `["iad1"]` ou remova a chave |
| `too many connections` (Neon) | `DATABASE_URL` sem `pgbouncer=true&connection_limit=1` | Ajuste a URL pooled e redeploy |
| Render: deploy ok, site “acordando” 30s | Instância free adormecida | Suba para Starter |
| E-mail não sai | Domínio Resend não verificado / `EMAIL_FROM` de outro domínio | Verifique DNS; o From tem que ser do domínio autenticado |
| "Esqueci minha senha" não manda nada e não dá erro | `RESEND_API_KEY` ausente — o envio vira no-op silencioso | Setar no Render e redeploy; confira o log: `Falha ao enviar e-mail de redefinição` |
| Link do e-mail aponta para `localhost` ou para o domínio errado | `APP_URL` não configurada (ou com barra no fim) | Setar `APP_URL`/`NEXT_PUBLIC_APP_URL` com `https://` e sem barra final |
| Link do e-mail sempre "inválido ou expirado" | Link tem 1 h e é de uso único; pedir outro invalida o anterior | Use o e-mail mais recente e clique só uma vez |
| `Node.js version` no Render | Runtime antigo | `NODE_VERSION=22` ou `.node-version` (já no repo) |
| Argon2 falha no build | Binário nativo | Confirme OS linux x64 (Vercel/Render); não use Edge runtime (as rotas já estão `nodejs`) |

---

## 8. Mapa rápido das URLs de produção

Substitua `https://SEU-DOMINIO`:

| Método | Caminho | Quem chama |
|---|---|---|
| GET | `/api/health` | Render health check, você |
| GET/POST | `/api/cron/billing` | Vercel Cron / Render Cron (`Bearer CRON_SECRET`) |
| POST | `/api/webhooks/mercadopago` | Mercado Pago |
| POST | `/api/webhooks/resend` | Resend (opcional) |
| GET | `/login` | Usuários |
| GET | `/admin` | Super-admin |
| GET | `/assinatura` | Empresa (pagamento) |
| GET | `/termos` `/privacidade` | Público |

---

## 9. Ordem mínima (colar na parede)

1. Push do `main` no GitHub  
2. Banco (Neon **ou** Postgres do Render)  
3. Variáveis no painel (incluindo `NEXT_PUBLIC_*`)  
4. Deploy com `prisma migrate deploy` no build  
5. `npm run db:seed` no banco de produção (`SEED_DEMO=false`)  
6. Login + troca de senha do super-admin  
7. Domínio + HTTPS + atualizar `APP_URL` / `NEXT_PUBLIC_APP_URL` + rebuild  
8. Webhook Mercado Pago + secret  
9. Resend com domínio verificado  
10. Disparar o cron na mão uma vez  
11. `npm run preflight` com `NODE_ENV=production`  
12. Checklist da seção 5.4  

Quando os 12 itens estiverem verdes, o CeasaPro está no ar.
