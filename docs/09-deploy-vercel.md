# 9. Deploy em produção — Vercel + Neon

Guia único de deploy do CeasaPro. A topologia é **app completo na Vercel**, **banco no Neon**, **e-mail no Resend**.

Documento irmão: instalação local em [`07-instalacao-e-deploy.md`](07-instalacao-e-deploy.md). Variáveis em [`.env.example`](../.env.example).

---

## 0. Uma plataforma, não duas

O CeasaPro é **um único app Next.js**: telas, rotas `/api/*`, Prisma e autenticação no mesmo projeto. Não existe "frontend aqui, backend ali" — e não dá para separar sem reescrever a camada de dados:

| Medida | Valor |
|---|---|
| Páginas (`page.tsx`) | 50 |
| Páginas que são client component | 1 |
| **Páginas server que consultam o banco direto** | **40** |
| Arquivos de Server Actions (`"use server"`) | 10 |
| Rotas `/api` | 19 |

`src/lib/api-client.ts` chama caminhos **relativos** e não há `rewrite` em `next.config.ts` nem em `vercel.json`. Server Action, por definição, faz POST para o próprio deployment que renderizou a página.

```
Browser --HTTPS--> Vercel (Next.js: telas + /api + Prisma) --> Neon Postgres
                     |
                     +-- Cron diário: /api/cron/billing
```

---

## 1. Antes do deploy

### 1.1 Contas

- [ ] GitHub com o repositório
- [ ] [Vercel](https://vercel.com) conectada ao GitHub
- [ ] [Neon](https://console.neon.tech) — Postgres
- [ ] [Mercado Pago](https://www.mercadopago.com.br/developers/panel/app) — aplicação de **produção**
- [ ] [Resend](https://resend.com) — com **domínio próprio verificado** (não envie pelo `*.resend.dev` em produção)

### 1.2 Gere os segredos (guarde num bloco de notas seguro)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Rode **duas vezes** e anote com rótulo:

| Rótulo | Uso |
|---|---|
| `JWT_SECRET` | Assina o cookie de sessão (mínimo 32 caracteres) |
| `CRON_SECRET` | Bearer que protege `POST /api/cron/billing` |

Escolha também uma `SEED_SUPERADMIN_PASSWORD` forte — é a senha inicial do super-admin, trocada no primeiro login.

Do Mercado Pago (aplicação de **produção**, prefixo `APP_USR-`):

| Variável | Onde copiar |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Credenciais de produção → Access Token |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | Credenciais de produção → Public Key |
| `MERCADOPAGO_WEBHOOK_SECRET` | Webhooks → chave secreta (depois de cadastrar a URL; veja §4.1) |

Do Resend:

| Variável | Exemplo |
|---|---|
| `RESEND_API_KEY` | começa com `re_` |
| `EMAIL_FROM` | `CeasaPro <nao-responda@seudominio.com.br>` (domínio verificado) |

WhatsApp de suporte (só dígitos, com DDI):

| Variável | Exemplo |
|---|---|
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | `5531999990000` (12 ou 13 dígitos) |

> Variáveis `NEXT_PUBLIC_*` entram no **JavaScript do browser na hora do build**. Se você mudar a public key ou o WhatsApp depois, **rebuild obrigatório** — não basta alterar o env e reiniciar.

### 1.3 O que **não** fazer em produção

- Não use `SEED_DEMO=true` (cria empresa de exemplo com senha fraca).
- Não rode `npx prisma migrate dev` contra o banco de produção (só `npm run prisma:deploy`).
- Não aponte o webhook do Mercado Pago para `localhost`.
- Não reutilize token de **teste** (`TEST-`) no ar.

---

## 2. Banco de dados (Neon)

O Prisma usa **duas** URLs: `DATABASE_URL` para as consultas da aplicação e `DIRECT_URL` para as migrations.

1. [console.neon.tech](https://console.neon.tech) → **New Project**.
2. Name: `ceasapro`. Region: **São Paulo (sa-east-1)** se aparecer; senão a mais próxima da América do Sul.
3. Postgres 16. Crie o projeto.
4. Em **Dashboard → Connection details**, copie as duas strings: a **Pooled** (host contém `-pooler`) e a **Direct** (host **sem** `-pooler`).
5. Monte as variáveis:

```
DATABASE_URL="postgresql://USER:SENHA@HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://USER:SENHA@HOST.REGION.aws.neon.tech/neondb?sslmode=require"
```

`pgbouncer=true` e `connection_limit=1` são **obrigatórios**: cada função serverless abre o próprio pool e, sem o limite, o Neon derruba conexões (`Error { kind: Closed }`).

6. Opcional: em **Settings**, ative PITR / backup automático no plano contratado.

Ainda **não** rode o seed — o app precisa existir primeiro para você ter a URL pública.

---

## 3. Vercel — passo a passo

### 3.1 Importar o projeto

Vercel → **Add New → Project** → selecione o repositório. O preset **Next.js** é detectado sozinho.

**Não** altere Build Command, Install Command nem Output Directory: o `package.json` já faz o certo —

```json
"build": "prisma generate && next build",
"postinstall": "prisma generate"
```

O `prisma generate` explícito no `build` é o que evita o erro clássico da Vercel (PrismaClient desatualizado) quando o cache de dependências pula o `postinstall`.

### 3.2 Variáveis de ambiente

Settings → **Environment Variables**. Marque **Production** (e Preview, se você usa previews).

**Obrigatórias — sem elas o login devolve 500:**

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Neon **pooled** + `?sslmode=require&pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Neon **unpooled** + `?sslmode=require` |
| `JWT_SECRET` | O segredo de 32+ bytes do §1.2 |

> `DIRECT_URL` é obrigatória **mesmo na Vercel**, embora só as migrations a usem: o `prisma generate` do build é a CLI do Prisma, e ela valida o bloco `datasource` inteiro. Sem ela o build falha com `Environment variable not found: DIRECT_URL` apontando a linha 12 do `schema.prisma`.

**Necessárias para as funcionalidades:**

| Variável | Observação |
|---|---|
| `APP_URL` | Domínio da Vercel, `https://`, **sem barra final** |
| `NEXT_PUBLIC_APP_URL` | Mesmo valor. **Entra no build** — mudou, precisa redeployar |
| `MERCADOPAGO_ACCESS_TOKEN` | |
| `MERCADOPAGO_WEBHOOK_SECRET` | |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | **Entra no build**; sem ela a assinatura cai em só-PIX |
| `RESEND_API_KEY` | Sem ela o envio de e-mail é no-op silencioso |
| `EMAIL_FROM` | Do domínio verificado no Resend |
| `CRON_SECRET` | A Vercel envia `Authorization: Bearer <CRON_SECRET>` sozinha no cron |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | **Entra no build**; vazia = botão de suporte some |

**Opcionais (têm default no código):** `ACCESS_TOKEN_TTL` (15m), `REFRESH_TOKEN_TTL_DAYS` (30), `EMAIL_REPLY_TO`, `RESEND_WEBHOOK_SECRET`, `LOG_LEVEL`.

**Não configure:**

| Variável | Por quê |
|---|---|
| `NODE_ENV` | A Vercel define sozinha; setar à mão quebra o build |
| `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL` | Injetadas automaticamente |
| `SEED_SUPERADMIN_*` | Só para rodar o seed, não em runtime |
| `R2_*` | Estão no `.env.example`, mas nenhuma linha do código as usa hoje |

> Rede de segurança: se `APP_URL` faltar, `src/lib/app-url.ts` cai em `VERCEL_PROJECT_PRODUCTION_URL` (produção) ou `VERCEL_URL` (preview), então os links de e-mail ainda saem com o domínio certo. Isso **não** substitui configurar `APP_URL`: `NEXT_PUBLIC_APP_URL` entra no bundle do browser em tempo de build e não tem fallback.

### 3.3 Região e limites do plano

O `vercel.json` **não** fixa região, de propósito: escolher região de função exige plano **Pro** e, no Hobby, o build reclama. Se você assinar o Pro e quiser latência menor no Brasil, acrescente:

```json
"regions": ["gru1"]
```

No **Hobby** a duração de cada função é limitada (~10s). Duas rotas podem esbarrar nisso com volume grande: `/api/reports/[type]/export` (gera PDF/Excel com `pdfmake`/`exceljs`) e `/api/cron/billing`. No Pro, dá para declarar `export const maxDuration = 60` nessas rotas.

### 3.4 Primeiro deploy

Dispare e acompanhe o log: deve mostrar `prisma generate` e terminar com `Compiled successfully`. Se parar em `Environment variable not found`, falta variável — volte ao §3.2 e **redeploy com "Clear build cache"** (variável nova não entra em build cacheado).

### 3.5 Migrations no Neon

O build da Vercel roda `prisma generate`, **não** `prisma migrate deploy`. As tabelas precisam existir antes do primeiro login. Confira no **Neon → SQL Editor**:

```sql
SELECT count(*) FROM users;
```

- `relation "users" does not exist` → migrations nunca rodaram. Aplique por um dos caminhos abaixo.
- Retorna um número → as tabelas existem; siga para §3.6.

**Caminho recomendado — GitHub Actions (já implementado).** O job `deploy` de [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) aplica migrations antes do deploy, e é ignorado quando o secret não existe. Basta criar em GitHub → Settings → Secrets and variables → Actions:

| Secret | Valor |
|---|---|
| `PROD_DIRECT_URL` | A **unpooled** do Neon (a mesma de `DIRECT_URL`) |

A partir daí, todo push em `main` roda `prisma migrate deploy` e só então libera o deploy. `migrate deploy` **aplica apenas migrations pendentes** — não recria tabela nem apaga dado.

**Alternativa — da sua máquina:**

```bash
DATABASE_URL="<unpooled do Neon>" DIRECT_URL="<unpooled do Neon>" npx prisma migrate deploy
```

> Em rede corporativa isso costuma falhar: muitas bloqueiam a saída na porta 5432. Teste antes com `Test-NetConnection <host-do-neon> -Port 5432`. Se der `False`, use o caminho do GitHub Actions.

### 3.6 Super-admin

Se `SELECT count(*) FROM users` voltou `0`, o banco está vazio e ninguém consegue entrar. Rode o seed uma única vez, apontando para o Neon:

```bash
SEED_SUPERADMIN_EMAIL="admin@seudominio.com.br" \
SEED_SUPERADMIN_PASSWORD="<senha forte>" \
SEED_DEMO="false" \
DATABASE_URL="<unpooled do Neon>" DIRECT_URL="<unpooled do Neon>" \
npm run db:seed
```

O seed é idempotente: rodar de novo não duplica nem sobrescreve. No primeiro login o sistema exige a troca dessa senha.

### 3.7 Domínio próprio

Settings → **Domains** → adicione o domínio e crie o registro DNS. Depois **atualize `APP_URL` e `NEXT_PUBLIC_APP_URL`** e **redeploy** — `NEXT_PUBLIC_APP_URL` só muda no bundle com um build novo.

### 3.8 Cron

O [`vercel.json`](../vercel.json) já declara:

```json
"crons": [{ "path": "/api/cron/billing", "schedule": "0 6 * * *" }]
```

Com `CRON_SECRET` configurada, a Vercel envia o header `Authorization: Bearer <CRON_SECRET>`, que é exatamente o que `src/app/api/cron/billing/route.ts` valida. Nada a fazer além da variável. No plano Hobby o cron é limitado a uma execução por dia — este é diário, então serve.

Para disparar na hora, sem esperar as 6h:

```bash
APP_URL="https://SEU-DOMINIO" CRON_SECRET="…" npm run cron:billing
```

---

## 4. Depois que o site está no ar

Use a URL **final** (domínio próprio, se já configurou). Troque `https://SEU-DOMINIO` abaixo.

### 4.1 Mercado Pago — webhook

1. [Painel de desenvolvedores](https://www.mercadopago.com.br/developers/panel/app) → sua aplicação de produção.
2. **Webhooks** → URL: `https://SEU-DOMINIO/api/webhooks/mercadopago`
3. Evento: **Pagamentos** (`payment`).
4. Copie a **chave secreta** → variável `MERCADOPAGO_WEBHOOK_SECRET` na Vercel.
5. Se o secret mudou, **não** precisa rebuild (não é `NEXT_PUBLIC_*`); um Redeploy recarrega o env do server.
6. Teste: gere um PIX de teste em `/assinatura` com uma empresa real. O status deve ir para pago sem recarregar à força — e o cron reconcilia no dia seguinte se o webhook falhar.

### 4.2 Resend — e-mail do "esqueci minha senha"

Sem esta configuração o botão **Esqueci minha senha** funciona na tela mas **nenhum e-mail sai**: a API responde a mesma mensagem genérica sempre (para não revelar quais e-mails existem), então o usuário não vê erro nenhum. Configure antes do go-live.

**1) Verifique o domínio no Resend**

1. Resend → **Domains → Add** o domínio que está em `EMAIL_FROM`.
2. Crie os registros DNS (SPF, DKIM e, de preferência, DMARC) e espere ficar **Verified**.
3. `EMAIL_FROM` tem que ser **do domínio verificado**. Enviar de `@gmail.com` ou do `*.resend.dev` em produção cai em spam ou é recusado.

**2) Variáveis na Vercel**

| Variável | Obrigatória | Observação |
|---|---|---|
| `RESEND_API_KEY` | sim | começa com `re_`; sem ela o envio é **no-op silencioso** |
| `EMAIL_FROM` | sim | `CeasaPro <nao-responda@seudominio.com.br>` |
| `APP_URL` | sim | origem do link do e-mail: `https://`, sem barra no fim |
| `EMAIL_REPLY_TO` | não | endereço de resposta monitorado; melhora a reputação anti-spam |
| `RESEND_WEBHOOK_SECRET` | não | só se cadastrar o webhook de bounce/spam |

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
| Limites | 5 pedidos / 15 min por IP e 3 / 15 min por e-mail, contados na tabela `rate_limits` (valem entre instâncias) |
| Trilha de auditoria | `audit_logs`: `PASSWORD_RESET_REQUESTED` e `PASSWORD_RESET` |

Depois da troca o usuário recebe um segundo e-mail ("Sua senha foi alterada") — é o aviso que permite reagir se não tiver sido ele.

Em **desenvolvimento**, sem `RESEND_API_KEY`, nada é enviado: o link aparece no log do servidor como `[DEV] Link de redefinição de senha`, o que permite testar o fluxo inteiro sem caixa de e-mail.

### 4.3 Pré-flight contra produção

Na sua máquina, com as URLs **direct** do banco de produção:

```bash
export NODE_ENV=production
export DATABASE_URL="…"
export DIRECT_URL="…"
# cole também JWT_SECRET, APP_URL, NEXT_PUBLIC_APP_URL, tokens MP, Resend, CRON_SECRET, WhatsApp
npm run preflight
```

Só siga se a saída for **Tudo certo. Pronto para o deploy.** Avisos de variável antiga (`MP_*`, `JWT_ACCESS_SECRET`) significam que alguém ainda configurou o nome velho — apague no painel.

### 4.4 DNS, HTTPS e cookies

O app marca o cookie `Secure` quando o proxy manda `x-forwarded-proto: https` (a Vercel faz isso). Se o domínio customizado ficar em HTTP ou num redirect mal configurado, o login "não pega". Sempre acesse pelo `https://`.

---

## 5. Checklist de fumaça (15 minutos)

- [ ] `GET /api/health` → `200` (só prova que o processo subiu, **não** que o banco responde)
- [ ] `/termos` e `/privacidade` abrem **sem** login
- [ ] `POST /api/auth/login` com o super-admin → `200` + `Set-Cookie: cp_access` e `cp_refresh`
- [ ] Senha errada → `401 E-mail ou senha incorretos` (se chegou aqui, a configuração está ok)
- [ ] 6 tentativas seguidas com senha errada → a 6ª devolve `429` (rate limit no banco funcionando)
- [ ] Login pela tela → troca de senha obrigatória → `/admin`
- [ ] F5 não desloga (cookie `Secure` funcionando sob HTTPS)
- [ ] Admin → **Planos**: Padrão e Básico ativos, preços corretos
- [ ] Admin → **Clientes → Novo**: cria empresa (nasce **suspensa** até pagar)
- [ ] Como OWNER: `/assinatura` mostra PIX e, se a public key estiver no build, o Payment Brick
- [ ] Pagamento aprovado → empresa **ATIVA** → `/dashboard`
- [ ] Webhook MP: no painel, último envio **2xx**
- [ ] Cron: execução manual devolve `ok: true`
- [ ] **Esqueci minha senha**: e-mail chega, link abre, senha nova entra e a antiga para de funcionar
- [ ] Link de redefinição já usado (ou de mais de 1 h) mostra "Link inválido ou expirado"
- [ ] Botão de WhatsApp aparece (se `NEXT_PUBLIC_SUPPORT_WHATSAPP` estava no **build**)
- [ ] Nenhum `PrismaClientInitializationError`, `JWT_SECRET não configurado` ou `kind: Closed` nos logs

---

## 6. Operação no dia a dia

### Deploys seguintes

- Push em `main` → a Vercel constrói de novo.
- Toda migration nova em `prisma/migrations/` entra no ar pelo job de deploy do GitHub Actions (§3.5). **Nunca** edite uma migration já aplicada em produção; crie outra.
- Mudança em `NEXT_PUBLIC_*` → precisa de build novo, não só redeploy do env.

### Logs

Deployment → **Runtime Logs**. Não devem aparecer senha, token ou payload de cartão (o logger redige esses campos).

### Backup

PITR / backup do Neon no plano contratado, mais um `pg_dump` periódico:

```bash
pg_dump "$DIRECT_URL" -Fc -f ceasapro-$(date +%Y%m%d).dump
```

### Rollback

**Deployments → Promote** um deployment anterior. Volta em segundos e **não desfaz migrations** (Prisma só vai para a frente) — se o problema foi de schema, restaure pelo point-in-time restore do Neon antes de promover.

### Pausar

Settings → **Pause project** (plano adequado) ou proteja com senha. O cron para junto.

---

## 7. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Build: `Environment variable not found: DIRECT_URL` | Só `DATABASE_URL` foi configurada | `prisma generate` valida o datasource inteiro — configure `DIRECT_URL` também |
| Build: `Environment variable not found: DATABASE_URL` | Env não marcada para Production | Recrie a variável e redeploy com **Clear build cache** |
| Build reclama de `gru1` | Região de função exige plano Pro | Não use `regions` no Hobby (§3.3) |
| Login 500 com `JWT_SECRET não configurado` | Variável ausente | Configure e redeploy com **Clear build cache** |
| Login 500 com `kind: Closed` | String sem `pgbouncer=true&connection_limit=1`, ou endpoint não-pooled | Use a **pooled** com os dois parâmetros |
| Login 500 com `relation "users" does not exist` | Migrations não aplicadas no Neon | §3.5 |
| Login 401 sempre | Banco certo, usuário em outro banco | Confira `SELECT count(*) FROM users` no Neon |
| Login 429 sem motivo | Janela de rate limit ainda aberta | `DELETE FROM rate_limits WHERE "keyHash" = '<hash>'`, ou espere 15 min |
| Tela de assinatura só PIX | `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` faltou **no build** | Configure e **rebuild** |
| Cron `401` | `CRON_SECRET` ausente ou diferente | A Vercel só manda o header se a variável existir |
| Pagou no MP e continua suspenso | Webhook 401/404 ou URL antiga | Confira a URL, o secret, e rode o cron |
| `too many connections` | Sem `connection_limit=1` | Ajuste a `DATABASE_URL` |
| E-mail não sai | Domínio Resend não verificado / `EMAIL_FROM` de outro domínio | Verifique DNS; o From tem que ser do domínio autenticado |
| Função excede o tempo limite | Relatório grande no plano Hobby | §3.3 |
| Argon2 falha no build | Binário nativo | Confirme Node 22 e runtime `nodejs` (as rotas já estão marcadas) |

---

## 8. Mapa rápido das URLs de produção

Substitua `https://SEU-DOMINIO`:

| Método | Caminho | Quem chama |
|---|---|---|
| GET | `/api/health` | Monitoração externa, você |
| GET/POST | `/api/cron/billing` | Vercel Cron (`Bearer CRON_SECRET`) |
| POST | `/api/webhooks/mercadopago` | Mercado Pago |
| POST | `/api/webhooks/resend` | Resend (opcional) |
| GET | `/login` | Usuários |
| GET | `/admin` | Super-admin |
| GET | `/assinatura` | Empresa (pagamento) |
| GET | `/termos` `/privacidade` | Público |

---

## 9. Ordem mínima (colar na parede)

1. Push do `main` no GitHub
2. Projeto no Neon + as duas connection strings
3. Importar o projeto na Vercel
4. Variáveis no painel (incluindo as `NEXT_PUBLIC_*`)
5. Secret `PROD_DIRECT_URL` no GitHub → migrations aplicadas
6. `npm run db:seed` no banco de produção (`SEED_DEMO=false`)
7. Login + troca de senha do super-admin
8. Domínio + HTTPS + atualizar `APP_URL` / `NEXT_PUBLIC_APP_URL` + rebuild
9. Webhook Mercado Pago + secret
10. Resend com domínio verificado
11. Disparar o cron na mão uma vez
12. `npm run preflight` com `NODE_ENV=production`
13. Checklist da seção 5

Quando os 13 itens estiverem verdes, o CeasaPro está no ar.
