# Contexto do CeasaPro para agentes

Documento de briefing. Leia isto **antes** de alterar código. Detalhes de tela, schema e cobrança estão nos outros arquivos de `docs/`; aqui está o mapa mental do produto **como o código está hoje**.

A especificação original (requisitos brutos) está em [`ESPECIFICACAO.md`](ESPECIFICACAO.md). Se houver conflito entre especificação antiga e o código, **o código e este briefing vencem**.

---

## 1. O que é

O **CeasaPro** é um SaaS de gestão para **comercializadores do CEASA** (hortifruti em boxes/bancas/galpões). O dono do box usa o celular no balcão para: cadastrar produtos e fornecedores, registrar compras (entrada de estoque com frete rateado), vender no PDV, controlar fiado, estoque, caixas plásticas, higienização, embalagens e despesas, e ver dashboard/relatórios.

É **multi-empresa (multi-tenant)**: cada comerciante é um `Tenant`. Dados operacionais nunca cruzam empresas. A receita da plataforma é **assinatura mensal** via Mercado Pago (PIX e cartão avulsos — **não** há débito automático).

Público: pouca familiaridade com tecnologia. Telas objetivas, botões grandes, português, poucos cliques. **Mobile-first.**

---

## 2. Quem usa (papéis)

| Papel | Quem | Onde |
|---|---|---|
| `OWNER` | Dono do box | `/dashboard` e módulos da empresa |
| `SUPER_ADMIN` | Operador da plataforma | `/admin` (clientes, planos, pagamentos, auditoria) |

Não existe `STAFF` nesta versão. O super-admin também pode **usar o sistema** num tenant interno (`AdminService.getOrCreateAdminWorkspace`) — nunca no tenant de um cliente. Esse ambiente não entra na lista/métricas de clientes.

---

## 3. Regras inegociáveis

Violar qualquer uma destas é regressão grave:

1. **Isolamento por tenant.** Em módulos de negócio use `getTenantPrisma(tenantId)`. O `tenantId` vem **só da sessão JWT**, nunca do body/query. `prisma` cru só em auth, super-admin, billing/webhooks e auditoria.
2. **Fórmulas financeiras só em** `src/lib/services/financial-calc.service.ts`. Não duplicar cálculo de total, lucro, margem ou rateio de frete.
3. **Dinheiro é `Decimal`**, nunca `number`/`Float`. Helpers em `src/lib/money.ts`. Quantidade: 3 casas; dinheiro: 2.
4. **Estoque e caixas plásticas são livros-razão.** Não existe coluna de saldo mutável. Saldo = soma de movimentos (`stock_movements`, `plastic_crate_movements`).
5. **Operações que tocam 2+ tabelas** rodam em `prisma.$transaction`, com `audit()` **dentro** da transação.
6. **PDV (`/vendas/nova`) é sagrado.** Não quebrar fluxo de venda no balcão (busca, carrinho, pagamento, fiado).
7. **Gating de módulo e cobrança no servidor.** Esconder do menu é só UX. Proxy + `requireModule` / `accessDecision` são a barreira real.
8. **Fuso `America/Sao_Paulo`** via `src/lib/tz.ts`. Nunca `setHours` / `toISOString().slice(0,10)` / `DATE_TRUNC` sem o fuso.
9. **Páginas públicas com `export const dynamic = "force-dynamic"`.** CSP usa nonce por request; HTML estático sai sem nonce e o JS some.
10. **Não há recorrência Mercado Pago.** Todo mês o cliente paga de novo em `/assinatura`.
11. **Trial de 7 dias só começa na confirmação de e-mail.** `graceDays` **não** se aplica a quem nunca pagou. Trial vencido → `SUSPENSO`, nunca `VENCIDO`.
12. **Cancelar assinatura** (Termos §5): para de renovar; o período **já pago** continua até `currentPeriodEnd`. Sem graça depois. Trial/já vencido encerra na hora.

---

## 4. Stack e execução

| Camada | Tecnologia |
|---|---|
| App | **Next.js 16** App Router + React 19 + TypeScript. Um único full-stack. |
| UI | Tailwind 4, componentes estilo shadcn + Radix, lucide-react, sonner |
| Dados | Prisma 6 + PostgreSQL (Neon em produção). **Não subir Prisma para v7** sem migrar config. |
| Auth | JWT com **jose** (não NextAuth). Senha **Argon2id**. Google OAuth (PKCE, redirect no servidor). |
| Pagamento | Mercado Pago: PIX próprio + Payment Brick (crédito/débito). |
| E-mail | nodemailer / SMTP Gmail |
| Relatórios | exceljs + impressão do navegador |
| Testes | Vitest (unit + integration) + Playwright (e2e) |

**Next.js 16:** o porteiro **não** é mais `middleware.ts`. É **`src/proxy.ts`** (Edge). Antes de criar APIs/metadados novos, leia `node_modules/next/dist/docs/` — esta versão quebra convenções antigas.

**Edge vs Node:** `proxy.ts` só verifica JWT (`jose`) e decide rota/CSP. Argon2, Prisma, Excel e Mercado Pago são Node.

**CSP:** nonce por request em `src/proxy.ts`. `script-src` é `'strict-dynamic'`. Payment Brick do MP e 3DS do banco exigem `frame-src`/`form-action` `https:`. Não “apertar” isso sem testar débito.

---

## 5. Camadas de código

```
Rota / Server Action (fino)  → Zod + sessão/tenant. Sem regra de negócio.
Service                      → lógica. Recebe dados validados + tenantId.
Prisma                       → getTenantPrisma nos módulos de negócio.
```

- **Server Actions** (`src/actions/`): CRUD simples (produtos, fornecedores, despesas, config, onboarding, admin, plano).
- **Route Handlers** (`src/app/api/`): transacional — vendas, compras, estoque, fiado, relatórios, billing, webhooks, cron, auth.

Envelopes: `withTenantAction` / `withAdminAction` e `withTenantRoute` / `withAdminRoute`. Resposta: `ActionResult<T>` = `{ ok: true, data }` ou `{ ok: false, error: { code, message, fields? } }`. Erros: `AppError` e subclasses.

Validação: **o mesmo schema Zod** em `src/lib/validations/` no cliente (RHF) e no servidor. O servidor sempre revalida.

---

## 6. Multi-tenancy

`src/lib/db/tenant-prisma.ts` — `$extends` injeta:

- leitura: `where.tenantId` + `where.deletedAt = null`
- create: `data.tenantId`
- update/delete: `where.tenantId`

Lista de models: `src/lib/db/models-tenant.ts` (`TENANT_MODELS` / `SOFT_DELETE_MODELS`). **Ao criar model com `tenantId`, incluir nessa lista** e no cleanup de `tests/helpers/factory.ts`.

Teste de segurança: `tests/integration/tenant-isolation.test.ts`.

---

## 7. Autenticação e sessão

Arquivos: `src/lib/auth/` (`jwt.ts`, `password.ts`, `refresh.ts`, `cookies.ts`, `build-session.ts`, `google-oauth.ts`).

- Login e-mail/senha; mensagem **genérica** (não revela se o e-mail existe).
- **Google:** `/api/auth/google` + callback. PKCE no servidor (não GIS JS — CSP bloqueia). Precisa de `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (os dois ou nenhum). Redirect: `$APP_URL/api/auth/google/callback`. Liga conta por `User.googleSub`.
- Access JWT ~15 min, cookie `httpOnly` / `Secure` / `SameSite=Lax`. Claims: `role`, `tenantId`, `tenantStatus`, `subStatus`, `modules`, `tev` (epoch da empresa), `sev` (epoch do usuário).
- Refresh opaco, hash SHA-256 em `refresh_tokens`, **rotação**, linhagem (`familyId`), janela de graça para abas concorrentes. Reuso de token revogado derruba a família.
- Logout / troca de senha / exclusão / bloqueio incrementam `sessionEpoch` (user e/ou tenant) e revogam refresh — o access antigo para de valer **na escrita** mesmo antes de expirar.
- Rate limit de auth no **Postgres** (`rate_limits`), compartilhado entre instâncias serverless.
- Cadastro público `/cadastro` → e-mail de confirmação → `emailVerifiedAt` → **aí** começa o trial. Sem confirmar, a empresa fica `SUSPENSA`.
- Recuperar senha: token 1h; ao redefinir, revoga todas as sessões.
- `mustChangePassword` força `/alterar-senha` (OWNER criado pelo admin).

Rotas públicas (sem sessão) estão em `PUBLIC_PREFIXES` de `src/proxy.ts`: login, cadastro, recuperar-senha, offline, consulta-offline, termos, privacidade, sitemap, robots, `/api/auth`, webhooks, cron, health. A landing `/` é caso especial (sem sessão mostra marketing; logado vai ao dashboard).

---

## 8. Cobrança, trial, cancelamento, planos

Fonte do status: `src/lib/billing/status.ts` (`computeStatus`, `accessDecision`, `billingNotice`). Serviço: `src/lib/services/billing.service.ts`.

### Status da assinatura

| Status | Acesso |
|---|---|
| `TRIAL` | ok (7 dias, só cadastro público após confirmar e-mail) |
| `ATIVO` | ok |
| `VENCIDO` | ok com aviso (`graceDays` — **só quem já pagou**) |
| `SUSPENSO` / `BLOQUEADO` / `CANCELADO` | bloqueado → `/conta/suspensa` |

`statusSource = MANUAL` (estorno, chargeback, admin) **vence** o cálculo automático e o cancelamento suave.

`accessDecision` é a fonte usada pelo proxy e pelos wrappers. Banner do dashboard é `billingNotice` (trial acabando ≠ mensalidade vencida ≠ cancelou e o mês pago ainda vale).

### Pagamento

- Tela `/assinatura` acessível **mesmo bloqueado** (`BILLING_SAFE_PREFIXES`).
- **PIX fora do Payment Brick** (o Brick pede e-mail para “enviar o código”; aqui o QR aparece na tela). Rota `POST /api/billing/checkout`.
- Cartão: Brick (`creditCard`/`debitCard` — normalizar camelCase **e** snake_case). `POST /api/billing/checkout/card`. Tokenização no browser. 3DS `optional`. Débito exige CPF.
- Confirmação **só** pelo webhook HMAC (`/api/webhooks/mercadopago`), idempotente por `mpPaymentId`. Não confiar no body: buscar o pagamento na API.
- Estorno → `SUSPENSO`; chargeback → `BLOQUEADO`; revoga sessões da empresa.
- **Uma cobrança viva por mês.** Troca de plano cancela QR antigo se o valor mudou.
- Valor cobrado **sempre do plano no banco**, nunca do que o cliente enviou.
- Cron `GET /api/cron/billing` (`CRON_SECRET`): reconcilia MP + recalcula status + lembrete 3 dias antes do vencimento (só quem já pagou, um e-mail por período).
- Não existe `preapproval`. Evolução em aberto.

### Cancelar

`BillingService.cancelarAssinatura` / `reativarAssinatura`. UI em `/plano` e Configurações. Pagar de novo limpa `cancelledAt`. Com cancelamento no período pago, `computeStatus` devolve `ATIVO` até `currentPeriodEnd`.

### Planos e módulos

Catálogo **único**: `src/lib/plan/modules.ts`.

**Núcleo (sempre):** dashboard, produtos, fornecedores, compras, PDV/vendas, fiado, estoque, despesas, relatórios básicos, config, atividades, meu plano, assinatura.

**Opcionais:** `caixas`, `higienizacao`, `embalagens`, `relatorios_avancados`. Gravados em `Plan.features.modules`. Plano **sem** `features.modules` = todos liberados (retrocompat).

Bloqueio em 3 camadas: menu → `proxy.ts` (redirect `/plano?bloqueado=` ou 403) → `module:` nos wrappers. Troca de plano: `PlanoService.changePlan` no servidor; depois `/api/auth/refresh` para reemitir o claim `modules`. Novo preço vale na **próxima** cobrança (sem pró-rata).

Não há limite de usuários/produtos por plano nesta versão.

---

## 9. Módulos de negócio

Fluxo típico do box: onboarding → compras (estoque sobe) → PDV (estoque desce; fiado cria conta) → receber fiado → despesas → dashboard/relatórios. Caixas/higienização/embalagens se o plano incluir.

### Onboarding (`/onboarding`)

Primeiro acesso do OWNER enquanto `onboardingCompletedAt` é nulo. Passos: dados da empresa → 1º fornecedor (opcional) → 1º produto (opcional). Demo do seed já vem concluído.

### Dashboard (`/dashboard`)

Números: hoje vendi, a receber, valor em estoque, lucro do mês. Gráfico 30 dias. Avisos (fiado vencido, despesas, higienização). CTAs: Nova venda, Novo produto, Novo fiado. Mais vendidos, prejuízo, estoque parado.

### Produtos / Fornecedores

CRUD Server Actions. Soft delete. Produto com histórico não apaga de fato.

### Compras (`POST /api/compras`)

Transação: itens + frete. Frete **rateado** no `unitCost`. Cada item → movimento de estoque `ENTRADA`.

### Vendas / PDV (`POST /api/vendas`)

`/vendas/nova` = frente de caixa. Pagamento: Dinheiro / PIX / Cartão / Fiado. Cliente obrigatório se fiado. Valida saldo de estoque. Grava `unitCostAtSale` para lucro. Fiado cria `CreditAccount` na mesma transação. Pode gerar saída de caixas plásticas.

### Fiado

Lista no formato da planilha do balcão (uma linha por entrega). Pagamento parcial `POST /api/fiado/pagamento`. `saldo = total − pago` (nunca negativo). Excluir **só sem pagamento**: desfaz a venda (soft delete), devolve estoque (`SALE_REVERSAL`) e caixas como limpas — tudo na mesma transação. `/fiado/novo` usa o mesmo caminho interno do PDV.

### Estoque

Posição derivada: `ENTRADA/AJUSTE − SAÍDA/QUEBRA/DOAÇÃO`. Ajuste manual `POST /api/estoque/ajuste`.

### Despesas

Fixa/variável, categorias (seed no provisionamento do tenant), pendente/pago. Entram no lucro líquido.

### Caixas plásticas (módulo `caixas`)

Movimentos: ENTRADA, SAÍDA, RETORNO, QUEBRA. Saldos derivados (vazias, com clientes, perdidas). Não deixar saída > vazias nem retorno > com clientes.

### Higienização (módulo `higienizacao`)

Envio → devolução parcial → pagamento parcial. Status ENVIADO → DEVOLVIDO → PAGO.

### Embalagens (módulo `embalagens`)

Tipos + vendas avulsas (caixa, sacaria, etc.).

### Relatórios (`/relatorios`, `GET /api/reports/[type]/export`)

Filtro de período. Imprimir/PDF e Excel. Tipos em `src/lib/reports/report.types.ts`. Básicos sempre; avançados atrás de `relatorios_avancados`. Novo relatório: tipo + `buildReport` — o hub/export entram sozinhos.

### Atividades (`/atividades`)

Auditoria da empresa em linguagem simples.

### Ajuda / tutorial

`/ajuda` é página de uso, **não** está no menu principal. O header tem botão Tutorial (página de uso + tour guiado). Logout está na sidebar / menu Mais, não no header.

### Configurações / Meu plano

`/configuracoes` (empresa + assinatura). `/plano` (módulos, troca de plano, cancelar).

---

## 10. Super-admin (`/admin`)

- Visão: empresas, MRR, status, novos no mês.
- Clientes: cria empresa+OWNER numa transação (senha temporária, assinatura suspensa até 1º pagamento, categorias padrão). Ativar / suspender / bloquear (revoga sessões).
- Planos: preço, módulos, ativo. Excluir só se nenhuma assinatura usa; senão desativar.
- Pagamentos e auditoria global.

Cadastro público é o outro caminho de aquisição (trial). Empresas do admin **não** ganham trial.

---

## 11. PWA, SEO, legal

- PWA: `src/app/manifest.ts`, `public/sw.js` (cache de assets), `pwa-register` em produção. Offline: `/offline` e `/consulta-offline` (snapshot no aparelho; limpar no logout).
- Push: `PushSubscription` por usuário/endpoint; cron `/api/cron/avisos`.
- SEO: `src/app/sitemap.ts` e `src/app/robots.ts` (públicos no proxy). Sitemap lista só `/`, `/cadastro`, `/login`, `/termos`, `/privacidade`. Search Console: enviar o caminho `sitemap.xml`. Verificação: `metadata.verification.google` em `src/app/layout.tsx`.
- Legal: `/termos`, `/privacidade`. Aceite gravado no tenant (`termsVersion`). Versão em `src/lib/legal.ts`.
- `APP_URL` / `NEXT_PUBLIC_APP_URL`: origem de todo link absoluto (e-mail, MP, sitemap). Sem barra final. Resolução em `src/lib/app-url.ts`.

---

## 12. Mapa de pastas

```
src/
  proxy.ts              porteiro Edge (auth, billing, módulos, CSP)
  app/
    page.tsx            landing pública
    sitemap.ts / robots.ts
    (auth)/             login, cadastro, recuperar-senha, alterar-senha
    (public)/           termos, privacidade
    (app)/              área OWNER + AppShell (bottom-nav / side-nav)
    (admin)/            super-admin
    onboarding/ assinatura/ conta/suspensa/
    api/                route handlers
  actions/              Server Actions finas
  lib/
    services/           regras (um arquivo por domínio)
    db/                 prisma + getTenantPrisma + models-tenant
    auth/ billing/ plan/ payments/ reports/ validations/
    http/               ActionResult, AppError, withAction, withRoute
    seo/                páginas indexáveis
    tz.ts money.ts format.ts labels.ts
  components/           ui/, layout/, billing/, auth/, crud/, data/, forms/
prisma/                 schema + migrations + seed
tests/
  unit/                 sem banco (cálculos, billing, tz, módulos…)
  integration/          Postgres local; criam/apagam tenants
  e2e/                  Playwright (auth.spec.ts = projeto público)
docs/                   este briefing + guias numerados
```

---

## 13. Como implementar mudança

CRUD novo:

1. Model Prisma (`tenantId`, timestamps, soft delete se couber) + migration.
2. Registrar em `models-tenant.ts` e no factory de testes.
3. Zod em `validations/`.
4. Service com `getTenantPrisma` + `audit()`.
5. Action `withTenantAction({ schema, handler, module? })`.
6. Telas em `src/app/(app)/…` (PageHeader, Card, DeleteButton).
7. Link em `bottom-nav.tsx` **e** `side-nav.tsx`.

Módulo pago: chave em `OPTIONAL_MODULES` + `module:` nas actions/rotas. O form de plano lê `OPTIONAL_MODULE_KEYS` sozinho.

Relatório: `REPORT_TYPES` + `buildReport`. Avançado → `ADVANCED_REPORTS`.

UI: tokens em `globals.css`. Variantes de botão existentes incluem `info` e `violet`. Listas no celular = cards; desktop = tabela + sidebar.

---

## 14. Testes

| Comando | O quê |
|---|---|
| `npm run test:unit` | Sem banco |
| `npm run test:integration` | Precisa Postgres **local**. Recusa `DATABASE_URL` remoto (`tests/setup/guard-database.ts`) a menos que `ALLOW_REMOTE_TEST_DB=1`. **Apaga dados das empresas de teste.** |
| `npx playwright test` | E2E. `E2E_PORT` se 3000 estiver ocupada. Projeto público: `tests/e2e/auth.spec.ts`. |

Integrações de destaque: isolamento de tenant, fluxo compra→estoque→venda→fiado, fase 2 (caixas/higienização/embalagens), billing (trial, cancelar, PIX), Google login.

Windows/PowerShell: **não** use `&&`. Use `;`. `prisma generate` dá EPERM se `next dev` estiver aberto (lock do `query_engine-windows.dll.node`).

---

## 15. Armadilhas (já pagas em produção)

- **`proxy.ts` vs `middleware.ts`:** docs antigas ainda dizem middleware. O arquivo real é `src/proxy.ts`.
- **Sitemap/robots sem prefixo público** redirecionam o Google para `/login`.
- Payment Brick: PIX **não** entra no Brick; método vem `credit_card` em runtime apesar do tipo `creditCard`.
- 3DS: sem `three_d_secure_mode: "optional"` o cartão real recusa e o de teste passa.
- `addOneMonth` próprio — `setMonth` nativo vaza 31/01 → março.
- `currentPeriodEnd` **ignorado** enquanto `activatedAt` é nulo (não virar trial eterno).
- Testes E2E de layout: cartões visíveis estão em `main .bg-card` (o `aside` também tem `bg-card` e é o primeiro match).
- Páginas públicas estáticas quebram CSP (`force-dynamic`).
- Dois `next dev` no Windows travam Prisma.

---

## 16. Onde aprofundar

| Assunto | Arquivo |
|---|---|
| Visão de produto | [`01-visao-geral.md`](01-visao-geral.md) |
| Arquitetura | [`02-arquitetura.md`](02-arquitetura.md) |
| Telas e regras por módulo | [`03-funcionalidades.md`](03-funcionalidades.md) |
| Schema | [`04-modelo-de-dados.md`](04-modelo-de-dados.md) + `prisma/schema.prisma` |
| Planos, PIX, cartão, cron | [`05-planos-e-modulos.md`](05-planos-e-modulos.md) |
| Auth, isolamento, webhook | [`06-seguranca.md`](06-seguranca.md) |
| Dev local / convenções | [`07-instalacao-e-deploy.md`](07-instalacao-e-deploy.md), [`08-desenvolvimento.md`](08-desenvolvimento.md) |
| Vercel + Neon | [`09-deploy-vercel.md`](09-deploy-vercel.md) |
| PWA | [`10-pwa-evolucao.md`](10-pwa-evolucao.md) |
| Next 16 (breaking) | `AGENTS.md` + `node_modules/next/dist/docs/` |
