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

1. **Isolamento por tenant.** Em módulos de negócio use `getTenantPrisma(tenantId)`. O `tenantId` vem **só da sessão JWT**, nunca do body/query. `prisma` cru só em auth, super-admin, billing/webhooks, auditoria, **cotações**, o **banco de fotos** (`catalogo_imagens`) e o **CeasaNews** (`noticias`, `noticias_coletas`) — porque as tabelas do boletim, o catálogo de fotos e as notícias são globais por desenho e a extensão multi-tenant cobriria só metade do módulo; nas cotações o `tenantId` entra explícito em cada consulta, e é isso que `tests/integration/cotacoes-vinculo.test.ts` guarda.
2. **Fórmulas financeiras só em** `src/lib/services/financial-calc.service.ts`. Não duplicar cálculo de total, lucro, margem ou rateio de frete.
3. **Dinheiro é `Decimal`**, nunca `number`/`Float`. Helpers em `src/lib/money.ts`. Quantidade: 3 casas; dinheiro: 2.
4. **Estoque e caixas plásticas são livros-razão.** Não existe coluna de saldo mutável. Saldo = soma de movimentos (`stock_movements`, `plastic_crate_movements`).
5. **Operações que tocam 2+ tabelas** rodam em `prisma.$transaction`, com `audit()` **dentro** da transação.
5b. **Escrita de dado da empresa fora de `withTenantAction`/`withTenantRoute`** (webhook, cron, action do admin, gravação feita numa leitura) chama `invalidarTenant(tenantId)` (`src/lib/cache/cache.ts`) depois de gravar. Boletim, CeasaNews e banco de fotos: `invalidarGlobal(...)`. Sem isso o Início mostra o número antigo até o TTL.
6. **PDV (`/vendas/nova`) é sagrado.** Não quebrar fluxo de venda no balcão (busca, carrinho, pagamento, fiado).
7. **Gating de módulo e cobrança no servidor.** Esconder do menu é só UX. Proxy + `requireModule` / `accessDecision` são a barreira real.
8. **Fuso `America/Sao_Paulo`** via `src/lib/tz.ts`. Nunca `setHours` / `toISOString().slice(0,10)` / `DATE_TRUNC` sem o fuso. `parseFormDateTz` **lança** `ValidationError` para data que não existe (`2026-02-31`) — nunca cai em `new Date(v)`.
9. **Páginas públicas com `export const dynamic = "force-dynamic"`.** CSP usa nonce por request; HTML estático sai sem nonce e o JS some.
10. **Não há recorrência Mercado Pago.** Todo mês o cliente paga de novo em `/assinatura`.
11. **Trial de 7 dias só começa na confirmação de e-mail.** `graceDays` **não** se aplica a quem nunca pagou. Trial vencido → `SUSPENSO`, nunca `VENCIDO`.
12. **Cancelar assinatura** (Termos §5): para de renovar; o período **já pago** continua até `currentPeriodEnd`. Sem graça depois. Trial/já vencido encerra na hora.
13. **Desfazer lançamento tem UMA regra** (`src/lib/desfazer/prazo.ts`): venda (à vista, fiada ou mista), venda de embalagem, compra, entrada e baixa de embalagem, ajuste manual de estoque, envio para higienização, recebimento de fiado e baixa de fiado como perda são desfeitos só até **24 h do registro** (`createdAt`, nunca a data digitada), só pelo OWNER (ou pelo super-admin no ambiente próprio dele — `podeDesfazer`). O lançamento **fica na base marcado** (`cancelledAt` / `reversedAt`), sai dos totais, e estoque/caixas voltam por **movimento de estorno** — nunca se apaga linha de livro-razão. Depois de 24 h ninguém desfaz: o fechamento do dia não é reescrito.

---

## 4. Stack e execução

| Camada | Tecnologia |
|---|---|
| App | **Next.js 16** App Router + React 19 + TypeScript. Um único full-stack. |
| UI | Tailwind 4, componentes estilo shadcn + Radix, lucide-react, sonner |
| Dados | Prisma 6 + PostgreSQL (Neon em produção). **Não subir Prisma para v7** sem migrar config. |
| Cache | Upstash Redis (REST, `@upstash/redis`), **desligado sem `UPSTASH_REDIS_REST_URL` + `_TOKEN`**. Só leitura com TTL curto + rate limit de login (`src/lib/cache/`, §13b) |
| Auth | JWT com **jose** (não NextAuth). Senha **Argon2id**. Google OAuth (PKCE, redirect no servidor). |
| Pagamento | Mercado Pago: PIX próprio + Payment Brick (crédito/débito). |
| E-mail | nodemailer / SMTP Gmail |
| Relatórios | exceljs (Excel) + pdfmake (PDF no servidor) + impressão do navegador |
| Erros | Sentry (`@sentry/nextjs`), **desligado sem `SENTRY_DSN`**. Só erros, sem tracing e sem dado de cliente (`src/lib/observabilidade/sentry.ts`). Source maps sobem no build só com `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` (`next.config.ts`) e são apagados da saída |
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

Envelopes: `withTenantAction` / `withAdminAction` e `withTenantRoute` / `withAdminRoute`. Os de rota recusam escrita de outra origem (`Origin`/`Sec-Fetch-Site`, 403) e corpo JSON sem `Content-Type: application/json` (415) — o `SameSite=Lax` não é mais a única barreira de CSRF. Erro inesperado (500 / "ref: …") vai ao Sentry com a tag `errorId`. Resposta: `ActionResult<T>` = `{ ok: true, data }` ou `{ ok: false, error: { code, message, fields? } }`. Erros: `AppError` e subclasses.

Validação: **o mesmo schema Zod** em `src/lib/validations/` no cliente (RHF) e no servidor. O servidor sempre revalida.

---

## 6. Multi-tenancy

`src/lib/db/tenant-prisma.ts` — `$extends` injeta:

- leitura: `where.tenantId` + `where.deletedAt = null`
- create: `data.tenantId`
- update/delete: `where.tenantId`

Operação que a extensão não sabe escopar (`isKnownTenantOp`) **lança erro** num model de tenant — nega por padrão. Versão nova do Prisma com operação nova: classifique-a em `models-tenant.ts`.

Lista de models: `src/lib/db/models-tenant.ts` (`TENANT_MODELS` / `SOFT_DELETE_MODELS`). **Ao criar model com `tenantId`, incluir nessa lista** e no cleanup de `tests/helpers/factory.ts`.

Teste de segurança: `tests/integration/tenant-isolation.test.ts`.

---

## 7. Autenticação e sessão

Arquivos: `src/lib/auth/` (`jwt.ts`, `password.ts`, `refresh.ts`, `cookies.ts`, `build-session.ts`, `google-oauth.ts`).

- Login e-mail/senha; mensagem **genérica** (não revela se o e-mail existe).
- **Google:** `/api/auth/google` + callback. PKCE no servidor (não GIS JS — CSP bloqueia). Precisa de `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (os dois ou nenhum). Redirect: `$APP_URL/api/auth/google/callback`. Liga conta por `User.googleSub`.
- Access JWT ~15 min, cookie `httpOnly` / `Secure` / `SameSite=Lax`. Claims: `role`, `tenantId`, `tenantStatus`, `subStatus`, `modules`, `tev` (epoch da empresa), `sev` (epoch do usuário).
- Refresh opaco, hash SHA-256 em `refresh_tokens`, **rotação**, linhagem (`familyId`), janela de graça para abas concorrentes. Reuso de token revogado derruba a família. A rotação e cada uso da graça são **reivindicados por update condicional** (`revokedAt: null` / `graceUses < teto`): chamadas simultâneas não saem todas com "ok" nem furam o teto.
- Troca de senha / exclusão / bloqueio incrementam `sessionEpoch` (user e/ou tenant) e revogam refresh — o access antigo para de valer **na escrita** mesmo antes de expirar.
- **Logout é por aparelho:** o access carrega `fid` (a `familyId` do refresh daquele aparelho). O logout revoga o refresh com motivo `LOGOUT`, e `sessaoAindaValida` recusa o access cuja linhagem foi encerrada (mesma consulta dos epochs). Os outros aparelhos seguem logados. Emissão: `createRefreshSession` devolve `{ raw, familyId }`.
- **As rotas de `/api/auth/*` também recusam outra origem** (`recusaDeOutraOrigem`, `src/lib/http/mesma-origem.ts`): sem isso, um `<form enctype="text/plain">` de outro site logava o dono na conta do atacante. Login, cadastro, recuperação, redefinição e troca de senha exigem JSON; refresh e logout (chamados sem corpo) só conferem a origem. A troca de senha confere `sessaoAindaValida`.
- Rate limit de auth no **Postgres** (`rate_limits`), compartilhado entre instâncias serverless. O contador **por e-mail** (login e recuperação) só recebe a tentativa que passou nos limites de IP — senão UM IP trancava a conta de qualquer um — e redefinir a senha zera o do login (`chaveDeLoginPorEmail`).
- Cadastro público `/cadastro` → e-mail de confirmação → `emailVerifiedAt` → **aí** começa o trial. Sem confirmar, a empresa fica `SUSPENSA`. O "já tem conta?" é decidido pela **identidade** do e-mail (`src/lib/email-identity.ts` → `User.emailIdentity`), não pelo texto: `dono+1@gmail.com` e `d.o.n.o@gmail.com` caem na mesma caixa e não rendem um segundo trial. O banco garante isso também na corrida: índice único parcial `users_email_identity_ativa` (conta ativa); a colisão (`ehColisaoDeIdentidadeDeEmail`) responde como "já tem conta". Só provedores de comportamento conhecido são normalizados — juntar demais recusaria cliente legítimo com uma resposta genérica que não explica nada.
- Recuperar senha: token 1h; ao redefinir, revoga todas as sessões.
- **Senha não comprovada** (`User.senhaComprovada`): o cadastro público grava `false` — quem preencheu o formulário pode não ser o dono do e-mail, e o dono pode clicar no link de confirmação sem saber. Redefinir a senha grava `true`. O login pelo Google descarta a senha (aleatória nova, sessões revogadas) quando o e-mail não está confirmado **ou** a senha não foi comprovada.
- **Sessão renovada antes da escrita no cliente:** o cookie `cp_exp` (não `httpOnly`, só o epoch de expiração do access) deixa `garantirSessao()` (`src/lib/api-client.ts`) renovar o access a menos de 60 s do fim, antes de cada `chamarAction`. Sem isso, a Server Action com access vencido caía no redirect do proxy e o formulário perdia o que foi digitado. No proxy, escrita fora de `/api` sem sessão responde 401 JSON, e o download de relatório (`/api/reports/*`) com refresh vivo passa por `/api/auth/renovar`.
- `mustChangePassword` força `/alterar-senha` (OWNER criado pelo admin).

Rotas públicas (sem sessão) estão em `PUBLIC_PREFIXES` de `src/proxy.ts`: login, cadastro, recuperar-senha, offline, consulta-offline, termos, privacidade, creditos-fotos, sitemap, robots, `/api/auth`, webhooks, cron, health. A landing `/` é caso especial (sem sessão mostra marketing; logado vai ao dashboard).

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
- Cartão: Brick (`creditCard`/`debitCard` — normalizar camelCase **e** snake_case). `POST /api/billing/checkout/card`. Tokenização no browser. 3DS `optional`. Débito exige CPF. **Exige e-mail confirmado** e tem teto no Postgres (5 tentativas/h por empresa, 10/h por IP): sem isso, contas descartáveis testavam cartão roubado e as recusas/chargebacks caíam na conta MP da plataforma. O PIX continua liberado.
- **A aprovação decide pelo momento do PAGAMENTO** (`mp.paidAt`, limitado a agora), não pelo do processamento: o webhook perdido e reaplicado no dia seguinte não dá mais os dias de tolerância de graça.
- **Pagamento acima do devido** é creditado e avisado ao super-admin (`PAGAMENTO_ACIMA_DO_DEVIDO`, auditoria `PAYMENT_OVERPAID`).
- **Reversão com pagamento DUPLICADO da mesma competência** promove o duplicado (`uncreditedReason = DUPLICADO`) a pagador do mês, na mesma transação, com o período e os módulos do revertido — e o acesso fica. Depois do commit o promovido é relido no MP.
- **O status recalculado só é gravado se a assinatura não mudou desde a leitura** (`gravarStatusCalculado`, condição em `updatedAt`) — no cron e no `buildAccessPayload`. Sem isso, o recálculo gravava `VENCIDO` por cima de um chargeback `BLOQUEADO`/`MANUAL` e o cliente seguia usando para sempre.
- Confirmação **só** pelo webhook HMAC (`/api/webhooks/mercadopago`), idempotente por `mpPaymentId`. Não confiar no body: buscar o pagamento na API. **Sem `MERCADOPAGO_WEBHOOK_SECRET` o webhook recusa tudo, em qualquer ambiente** — não há mais bypass por `NODE_ENV` (preview e staging são "development" com banco de verdade).
- **Uma cobrança APROVADA por competência**, garantida pelo banco: `SubscriptionPayment.approvedKey` (`<tenantId>:<referenceMonth>`, `@unique`, nula fora de APROVADO). Sem ela, o segundo pagamento do mês creditava o mês de novo.
- Estorno → `SUSPENSO`; chargeback → `BLOQUEADO`; revoga sessões da empresa — **só se não sobrar outro pagamento APROVADO da mesma competência**. Sobrando, o acesso fica e a reversão é só uma linha do extrato mudando de status. **Estorno** (não chargeback) com outro período pago correndo — vencimento ainda futuro depois de tirar o estornado e outro APROVADO com `periodEnd` futuro — também não bloqueia: só o vencimento recua. Chargeback bloqueia sempre.
- **Onde começa o mês pago:** `inicioDoPeriodoPago` (`billing/status.ts`). Adiantado ou pago **dentro da tolerância** → no vencimento (recomeçar no dia do pagamento dava os dias de tolerância de graça todo mês); primeiro pagamento ou depois de ficar sem acesso → hoje.
- **Onde termina o mês pago (dia âncora):** `TenantSubscription.diaAncora` (1–31). A aprovação calcula `addOneMonth(periodStart, diaAncora)`: o mesmo dia do mês seguinte, limitado ao último dia dele, sem partir do vencimento já ajustado (31/01 → 28/02 → 31/03 → 30/04). O período que recomeça hoje (primeiro pagamento, ou depois de ficar sem acesso) grava o dia do pagamento como nova âncora. Assinatura anterior à coluna (`diaAncora` nulo): a primeira aprovação recupera a âncora pelo início da cadeia de pagamentos APROVADOS (`diaAncoraDoHistorico`); sem cadeia conclusiva, vale o dia do vencimento atual. O estorno de um mês do meio recua um mês na âncora (`subOneMonth`).
- **Reajuste do admin** (`updateMonthlyAmount`) baixa e cancela no MP o QR do valor antigo, como a troca de plano.
- **Uma cobrança viva por empresa** — de qualquer competência. Gerar PIX/cartão e aprovar pagamento baixam (e cancelam no MP) as pendentes de **todas** as competências: o QR esquecido do mês passado, pago depois, comprava um segundo mês. Troca de plano cancela QR antigo se o valor mudou.
- Valor cobrado **sempre do plano no banco**, nunca do que o cliente enviou.
- Cron `GET /api/cron/billing` (`CRON_SECRET`): reconcilia MP + recalcula status + lembrete 3 dias antes do vencimento (só quem já pagou, um e-mail por período).
- Não existe `preapproval`. Evolução em aberto.
- **Reconciliação com orçamento:** 20 s, 6 chamadas ao MP ao mesmo tempo, fila rotativa por `SubscriptionPayment.lastReconciledAt`. As tarefas locais do cron rodam mesmo se ela falhar.
- **QR substituído é cancelado no MP** (`cancelPayment`, best-effort, depois do commit) — não só no banco.
- **Aprovado que não comprou mês** (valor a menor, duplicado): `uncreditedAt`/`uncreditedReason`, com aviso ao super-admin `PAGAMENTO_NAO_CREDITADO`. Nunca credita o mês duas vezes.
- **Pagamento antecipado:** dentro de `DUE_REMINDER_DAYS` do vencimento, `competenciaACobrar` cobra a competência do PRÓXIMO período. Fora da janela, `MENSALIDADE_JA_PAGA` — decidido pelo **período pago** (um APROVADO com `periodEnd` futuro), não pelo rótulo do mês: quem pagou em 15/09 não vê "outubro em aberto" em 01/10. Bloqueio MANUAL fica de fora (o chargeback se desfaz pagando).
- **Chargeback desfeito por pagamento:** o acesso volta sozinho e o admin é avisado (`BLOQUEIO_DESFEITO_POR_PAGAMENTO`). Para manter bloqueado, bloqueie a empresa (`Tenant.status`).

### Cancelar

`BillingService.cancelarAssinatura` / `reativarAssinatura`. UI em `/plano` e Configurações. Pagar de novo limpa `cancelledAt`. Com cancelamento no período pago, `computeStatus` devolve `ATIVO` até `currentPeriodEnd`.

### Planos e módulos

Catálogo **único**: `src/lib/plan/modules.ts`.

**Núcleo (sempre):** dashboard, produtos, fornecedores, compras, PDV/vendas, fiado, estoque, despesas, relatórios básicos, config, meu plano, assinatura.

**Opcionais:** `caixas`, `higienizacao`, `embalagens`, `cotacoes`, `relatorios_avancados`, `ceasanews`. Gravados em `Plan.features.modules`. Plano **sem** `features.modules` = **nenhum** opcional liberado (fail-closed; `AdminService` exige a lista ao criar/salvar plano). `{ "modules": [] }` é como se diz "só o núcleo".

Bloqueio em 3 camadas: menu → `proxy.ts` (redirect `/plano?bloqueado=` ou 403) → `module:` nos wrappers.

**Tela de dois módulos:** `TELAS_COMPARTILHADAS` (em `modules.ts`) lista caminhos EXATOS que abrem com qualquer um de vários módulos — hoje só `/caixas-plasticas` (caixas **ou** embalagens). Proxy e menu perguntam por `modulosDaRota`/`rotaLiberada`, não por `moduleForPath`. As subtelas continuam do módulo dono pelo prefixo, cada uma com o próprio `layout.tsx` (`paginas-module-gate.test.ts` recusa subtela sem ele). As chaves **não** se juntam.

**Troca de plano:** `PlanoService.changePlan` no servidor; depois `/api/auth/refresh` para reemitir o claim `modules`. Recusa o plano atual, plano inativo e o **plano interno do super-admin** (por slug, não por `active`). Novo preço vale na **próxima** cobrança (sem pró-rata).

**Com a competência do mês já paga a troca é AGENDADA**, não aplicada: grava `pendingPlanId`/`pendingPlanFrom = currentPeriodEnd` e o plano vigente continua valendo até lá. A mensalidade compra o mês, e aplicar na hora entregava o plano caro ao preço do barato (ou tirava módulos já pagos, no downgrade). Quem faz valer é `aplicarTrocaProgramada`, chamada em `buildAccessPayload`, `prepareCharge`, `getPlanoView` e no cron.

**O período pago congela preço e módulos.** Quais módulos a empresa tem é decidido **só** por `featuresVigentes` (`src/lib/plan/features-vigentes.ts`), usado pelo token, por `/plano` e pelos avisos push: pagamento APROVADO que gravou `SubscriptionPayment.features` e cobre agora → `TenantSubscription.heldFeatures` até `heldFeaturesUntil` → **período vencido (tolerância): interseção** do que o último pagamento APROVADO comprou com o plano de agora → `plan.features` vivo. A troca de plano em `VENCIDO` vale na hora (decide o valor da cobrança), mas subir não libera módulo antes de o pagamento aprovar, e descer tira na hora. Trial fica no catálogo vivo. `AdminService.updatePlan` congela os módulos antigos de quem já pagou o período (sem estender congelamento existente); o agendamento grava `pendingPriceMonthly`/`pendingFeatures` e é isso que a renovação cobra e a virada aplica. Reajuste do catálogo **nunca** muda `monthlyAmount` de quem já assinou — só `updateMonthlyAmount`. Troca de plano, edição/exclusão de plano e aprovação de pagamento travam as linhas (`src/lib/billing/travas.ts`); a conferência do valor devido roda dentro da transação que aprova.

Não há limite de usuários/produtos por plano nesta versão.

---

## 9. Módulos de negócio

Fluxo típico do box: onboarding → compras (estoque sobe) → PDV (estoque desce; fiado cria conta) → receber fiado → despesas → dashboard/relatórios. Caixas/higienização/embalagens se o plano incluir.

### Onboarding (`/onboarding`)

Primeiro acesso do OWNER enquanto `onboardingCompletedAt` é nulo. Passos: dados da empresa → 1º fornecedor (opcional) → 1º produto (opcional). Demo do seed já vem concluído.

### Dashboard (`/dashboard`)

Duas abas por URL: **Visão Geral** (números do dia, avisos, contas a pagar, listas de produtos) e **Financeiro** (`?aba=financeiro`: fechamento do mês + gráficos). CTAs: Nova venda, Novo produto (`/estoque?novo=1`), Novo fiado. A série do Financeiro vem de `PainelFinanceiroService` (mesmas janelas e filtros do resumo — só despesa `origem = 'MANUAL'`; o teste `painel-financeiro.test.ts` garante que fecha com os cartões). Gráficos em `src/components/financeiro/graficos.tsx`, HTML/CSS no servidor, sem biblioteca; cores `viz-1/2/3` (Vendas/Compras/Contas, ordem fixa, validadas para daltonismo) em `globals.css`. **Como é calculado:** todo card de número (as duas abas) e todo gráfico do Financeiro abrem uma janela com a conta montada com os MESMOS números da tela, o que entra e o que fica de fora (`src/lib/financeiro/explicacoes.ts`, sem consulta nova; janela em `src/components/financeiro/explicacao.tsx`). Mudou uma fórmula do resumo? Mude a explicação junto — `tests/unit/explicacoes-inicio.test.ts` confere que a soma de cada janela fecha com o card.

### Estoque = Produtos + Compras + Estoque

Uma tela só: `/estoque` (abas Produtos | Compras), `/estoque/compra` e `/estoque/ajuste`. `/produtos*` e `/compras*` só redirecionam; Produtos e Compras saíram do menu.

**Produto** (Server Actions, soft delete, sem histórico não apaga de fato; **exclui também com saldo**, depois da confirmação na tela: a exclusão lança antes um `AJUSTE` negativo `PRODUCT_DELETED` do saldo pelo custo médio, que entra nas perdas do mês — o valor nunca some sem registro): cadastro/edição no modal `src/components/produtos/produto-modal.tsx`, aberto por `?novo=1` / `?editar=<id>`. Campos novos: `salePrice` (no PDV vence o sugerido pela compra, perde para o da última venda), `minStock` (alerta por produto em `nivelEstoque`; nulo = `ESTOQUE_BAIXO`), `imageKey`. **Estoque inicial** = `ENTRADA` com `sourceType: "ESTOQUE_INICIAL"` na transação do produto. O custo é obrigatório, salvo a opção "Não cadastrar o custo agora": aí `unitCost` fica nulo (nunca R$ 0). Essa quantidade entra no saldo e fica fora do custo médio, do valor em estoque, do CMV, do lucro e da margem; a saída come esse saldo primeiro.

**Foto** (Cloudflare R2, `src/lib/storage/r2.ts` com `aws4fetch`): Câmera (`<input capture>`, não depende de `getUserMedia` nem do `Permissions-Policy`), Galeria ou **Banco** (`catalogo_imagens`, global, mantido em `/admin/imagens`; **só foto em domínio público ou CC0** — nada que exija crédito; a origem de cada uma fica em `src/lib/imagem/creditos-banco.ts`, que alimenta a página pública `/creditos-fotos`). Comprimida no aparelho (`src/lib/imagem/comprimir.ts`) e enviada **pelo servidor** (Server Action) — por isso a CSP não libera o host do R2 em `connect-src`. O tipo é decidido pelos magic bytes. `ProdutoImagemService.validarChave` só aceita chave da própria empresa ou foto ativa do Banco. Sem as cinco `R2_*`, os botões ficam desabilitados. Envio limitado a 100 fotos/empresa/dia (`rate_limits`); foto de empresa que nenhum produto usa há mais de 24 h (formulário abandonado) é apagada do bucket pelo cron de billing (`limparOrfas`, por último, com prazo).

**Compra** (`POST /api/compras`): transação com itens + frete. Frete **rateado** no `unitCost`. Cada item → movimento `ENTRADA`. E **uma despesa `origem = COMPRA`** no valor total, com o fornecedor, `PAGO` (`paidDate = purchaseDate`) ou `PENDENTE` até o vencimento — ver Despesas. Trava fornecedor e produtos com `FOR SHARE` (a exclusão deles trava `FOR UPDATE`).

**Cancelar compra** (`ComprasService.cancelarCompra`, botão na aba Compras): regra §3.13, e só se os produtos dela **não tiveram saída nem ajuste depois dela** (esses movimentos já gravaram o custo dela; tirá-la do repasse deixaria o CMV errado para sempre). Marca `Purchase.cancelledAt`; tira a mercadoria com `AJUSTE` negativo `sourceType = PURCHASE_CANCELLED`; estorna as caixas que vieram com ela (ENTRADA espelhada, ligada por `PlasticCrateMovement.purchaseId`); soft-delete da despesa `COMPRA` (paga ou não). Toda leitura de compra filtra `cancelledAt` — compra cancelada aparece **só** na lista, riscada.

### Fornecedores

CRUD Server Actions. Soft delete — **recusado com conta a pagar pendente** (a dívida ficaria sem nome). A tela mostra o histórico de compras com a situação da conta e o total em aberto com o fornecedor.

### Vendas / PDV (`POST /api/vendas`)

`/vendas/nova` = frente de caixa. Pagamento: Dinheiro / PIX / Cartão / Fiado. Cliente obrigatório se fiado. Valida saldo de estoque. Grava `unitCostAtSale` para lucro. Fiado cria `CreditAccount` na mesma transação. Pode gerar saída de caixas plásticas.

**Cancelar venda** (`VendasService.cancelarVenda`) é o **único** caminho para desfazer venda — o fiado também passa por ele. Regra §3.13; recusa com recebimento de fiado vivo. A mercadoria volta com `AJUSTE` `SALE_CANCELLED` pelo **custo com que saiu** (`unitCostAtSale`): é a mesma mercadoria, e a média se recompõe com ela. Não use a média da hora — daria à mercadoria velha o preço da compra nova e inflaria o valor do estoque.

**Retirada** (`Sale.retirarDepois` / `retiradoEm`): no PDV a etapa "Retirada" é **obrigatória** (`vendaPdvSchema`, só na rota `/api/vendas`; o fiado manual omite = levou na hora). "Busca depois" exige nome do cliente e nasce com `retiradoEm` nulo; o checkbox "Buscado" da lista de vendas, da venda e da ficha do cliente chama `VendasService.marcarRetirada` (auditado; desmarcar é permitido). Pendentes viram o aviso `retirada_pendente` (sino, Início e push), depois do dinheiro e antes da cotação. A lista de vendas mostra a foto e o nome dos produtos.

### Clientes (aba de Vendas, núcleo)

Vendas e Clientes são uma tela só: `/vendas` (abas Vendas | Clientes, `?aba=clientes`) e a ficha em `/vendas/clientes/[chave]`. `/clientes*` só redireciona; no menu o item é "Vendas e clientes". Sem tabela própria: cliente = nome da venda sem caixa e sem espaços nas pontas (`chaveDoCliente`, a mesma identidade do fiado). `ClientesService.list` agrupa as vendas vivas; a ficha mostra todas as compras com itens e fotos, fiado em aberto e retiradas pendentes.

### Fiado

Lista no formato da planilha do balcão (uma linha por entrega). Pagamento parcial `POST /api/fiado/pagamento`. `saldo = total − pago` (nunca negativo). `/fiado/novo` usa o mesmo caminho interno do PDV. O recebimento e o fiado manual têm `idempotencyKey` (`credit_payments (tenantId, idempotencyKey)` único; o fiado manual repassa a chave à venda): o reenvio depois de um timeout devolve o já gravado. **Atrasado** tem uma régua só (`src/lib/fiado/atraso.ts`): vencimento antes de hoje, ou sem vencimento e aberto há mais de 30 dias — no relatório de inadimplentes, no sino, no push e em `/fiado`.

- **Cancelar venda** pela conta (`FiadoService.cancelarVendaDoFiado`) = `VendasService.cancelarVenda` (mesmo prazo, a venda fica no histórico). Antes o fiado era APAGADO a qualquer tempo — não volte a apagar.
- **Estornar recebimento** lançado errado (`FiadoService.estornarPagamento`, regra §3.13): `CreditPayment.reversedAt`, `paidAmount` volta, conta reabre. Recebimento estornado fica no extrato e sai do fluxo de caixa (`"reversedAt" IS NULL`) e da checagem de "tem recebimento".
- **Baixar como perda** o fiado que não vai ser pago (`FiadoService.baixarComoPerda`, OWNER, motivo obrigatório): `status = PERDA`, saldo em `writtenOffAmount`, data em `writtenOffAt`. Sai do "a receber" e dos avisos; a perda entra no lucro do mês da **baixa** ("Perda com fiado", `FinancialCalc.lucroLiquido`), nunca no da venda — a soma é pela marca `writtenOffAt`, não pelo status. Se o cliente pagar depois, o recebimento é `CreditPayment.aposBaixa` e entra no lucro do mês em que chega ("Recebido de fiado baixado"); quitada, a conta vira PAGO e a perda daquele mês continua lá. **Conta antiga SEM venda** (`saleId` nulo, de antes de o fiado manual gerar venda): a baixa tira do "a receber", mas nem a perda nem o recebido depois dela entram no lucro (a receita nunca entrou); o relatório `FIADO_PERDAS` a mostra na coluna "Sem venda (fora do lucro)". Depois da baixa só o recebimento `aposBaixa` é estornável (volta a PERDA); a venda não é cancelada. `desfazerBaixa` só até 24 h e sem recebimento depois da baixa.

### Estoque

Posição derivada: `ENTRADA/AJUSTE − SAÍDA/QUEBRA/DOAÇÃO`. Ajuste manual `POST /api/estoque/ajuste` (`sourceType = MANUAL`).

**Perdas e acertos de estoque entram no lucro do mês** (`perdasEstoqueMes`, pela data do movimento e pelo custo gravado nele): quebra, doação e acerto para baixo somam; acerto para cima abate. Vão em `FinancialCalc.custoDoVendido` junto com o CMV — sem isso, a mercadoria que estragava não descontava em lugar nenhum e o lucro saía sempre para cima.

**Desfazer ajuste** (`EstoqueService.desfazerAjuste`, tela `/estoque/ajuste`, regra §3.13): AJUSTE espelhado `MANUAL_CANCELLED` com `sourceId` = ajuste; o par sai do repasse do custo médio (`sqlCustoEstoque`) e da perda do mês. Recusa se o produto teve qualquer movimento depois do ajuste, ou se o produto foi excluído (a lista `ajustesRecentes` o esconde e devolve `podeDesfazer`, para a tela não oferecer o que o servidor recusa). No ajuste, o `unitCost` digitado só vale para entrada; saída sai pelo custo médio.

Quantidade com no máximo 3 casas, preço/frete/custo com 2 (custo de ajuste: 4), tetos de valor e no máximo 200 itens por venda/compra (`src/lib/validations/quantidade.ts`).

Custo = **média ponderada móvel do estoque atual** (`sqlCustoEstoque`), repassada em ordem de **gravação** (`createdAt`), não de `movedAt`: a entrada pondera com o que sobrou, a saída sai pela média sem alterá-la, saldo ≤ 0 reinicia a média e vale zero. O `unitCost` gravado nas saídas é ignorado no cálculo. A ENTRADA de compra cancelada e o estorno dela saem **juntos** do repasse (o preço errado não fica na média; o par soma zero no saldo). Só a quantidade: `EstoqueService.getQuantidades` (sem a conta de custo). `sourceType` em `src/lib/estoque/origens.ts`.

Compra tem `idempotencyKey` (como a venda): o reenvio devolve a compra já gravada. O mesmo vale para ajuste de estoque, entrada e venda de embalagem e envio para higienização (`comIdempotencia`, `src/lib/http/idempotencia.ts`; único `(tenantId, idempotencyKey)`). **No formulário a chave é por conteúdo** (`chavePorConteudo`, `src/lib/idempotencia-cliente.ts`): o mesmo corpo reenviado usa a mesma chave; corpo editado ganha outra. O PDV é a exceção (chave por carrinho) e confere o `totalAmount` devolvido: se a venda gravada não for a do carrinho atual, avisa e mantém o carrinho.

**Data de lançamento** (venda, fiado manual, compra, venda de embalagem, envio e pagamento de higienização): não antes do **início do mês passado** (`dataNaoAntesDoMesPassado`, `MSG_DATA_ANTIGA` em `validations/venda.ts`). Sem o piso, o lançamento retroativo reescrevia o resultado de meses já fechados, que o desfazer (§3.13) protege. Despesa fica fora (conta esquecida e vencimento antigo são normais).

### Despesas

Fixa/variável, categorias (seed no provisionamento do tenant), pendente/pago, fornecedor opcional. `Expense.origem` separa as duas naturezas:

- `MANUAL` (operacional): entra no lucro líquido, em Fixas/Variáveis e no "% do faturamento".
- **Higienização** entra no lucro e em Variáveis pela data de **envio** (como a conta operacional, pelo vencimento) — uma data só no painel. O pagamento dela conta em "Pagas" e no fluxo de caixa.
- **Faturamento** = venda de mercadoria + venda de embalagem (`FinancialCalc.faturamento`): é a base do lucro bruto, da margem e do "% do que você vendeu". "Vendi" continua só mercadoria; o "Resultado do mês" mostra a embalagem numa linha própria.
- `COMPRA` (gerada pela compra; índice único parcial `expenses_compra_unica`) e `FRETE_COMPRA` (frete lançado à parte antes desta versão): o custo **já está no CMV**, então ficam **fora** de lucro, Fixas/Variáveis, `totais`, `replicarMes` e "nova igual à última", e **dentro** de Contas a Pagar, vencidas, avisos/push, `CONTAS_PAGAS` e **fluxo de caixa** (que não lê mais `purchases.totalAmount` — a compra sai do caixa pela `paidDate` da conta). Filtro: `SO_OPERACIONAIS` / `ORIGENS_DE_COMPRA` em `despesas.service.ts`.
- `COMPRA_EMBALAGEM`: gerada pela entrada de embalagem com custo (`Expense.packagingMovementId`), PAGA no dia. Está em `ORIGENS_DE_COMPRA` — fora do lucro (o custo entra pela venda), dentro do caixa e das pagas. Desfazer a entrada (24 h) cancela a conta.
- **Recorrente de dia 29/30/31:** `proximoVencimento(data, diaAncora)` com `diaAncoraDaCadeia` (o dia da raiz da cadeia por `parentId`, só quando o vencimento atual caiu no último dia do mês). Fevereiro encolhe para 28 e março volta ao 31.
- Conta de compra: valor/descrição/fornecedor travados, não exclui, não duplica. Compras antigas ganharam a conta no backfill da migration `20261016120000_estoque_unificado_compra_despesa` (PAGA na data da compra; sem o frete se ele já tinha despesa própria).

### Caixas e embalagens (`/caixas-plasticas`, módulos `caixas` e `embalagens`)

Uma tela com duas abas (Radix Tabs, aba na URL: `?aba=embalagens`). Quem tem só um dos módulos vê só a aba dele, sem lista de abas; sem nenhum, não entra. `/embalagens` e `/embalagens/nova` só redirecionam (a segunda abre a venda em folha, `&nova=1`). Menu: um item, "Caixas e embalagens". O tour tem um capítulo só, com passos marcados por `modulo`.

**Caixas plásticas** — movimentos: ENTRADA, SAÍDA, RETORNO, QUEBRA, VENDA (mais os de higienização e os estornos). Saldos derivados (limpas, sujas, com clientes, perdidas). Não deixar saída ou venda > limpas nem retorno > com clientes. **A ENTRADA manual exige o custo de cada caixa** (`unitCost`) e gera a conta `COMPRA_EMBALAGEM` paga (`Expense.plasticCrateMovementId`), desfazível em 24 h (`CaixasService.desfazerEntrada`, ENTRADA negativa com `estornaId`). A ENTRADA da compra também pede o custo (`caixasCustoUnitario`), mas não gera conta — o fornecedor já é a conta da compra.

**Caixa plástica é UM estoque só nas duas abas.** O tipo de embalagem com `PackagingType.caixaPlastica` (o "Caixa plástica" padrão; no máximo um por empresa) não tem estoque em `packaging_movements`: o saldo dele são as caixas **limpas** (`EmbalagensService.saldos`), a venda grava uma `VENDA` em `plastic_crate_movements` (ligada por `packagingSaleId`, sai das limpas, não fica com cliente) e a entrada vira ENTRADA de caixas. A venda sai pelo custo médio das caixas que a empresa possui (`custoMedioDasCaixas`: ENTRADA forma, VENDA/QUEBRA saem, empréstimo e higienização não contam; estornos saem em par). Cancelar a venda grava a VENDA negativa. "Controlar" e "Baixa" não valem para esse tipo (a perda é "Registrar perda" em Caixas). Saldo próprio de antes do vínculo: `npx tsx scripts/vincular-caixas-embalagens.ts` depois do deploy (`transferirSaldoParaCaixas`, AJUSTE `PACKAGING_TO_CRATES`). **Cliente das caixas = nome sem caixa nem espaços nas pontas** (`lower(btrim(...))` em `saldoPorCliente`, `mode: "insensitive"` em `saldoDoClienteInTx`; `SaldoDeCaixasPorCliente.get` normaliza): "João" e "joão" são a mesma pessoa.

**Embalagens** — tipos + vendas avulsas (papelão, sacaria etc.), estoque por tipo opcional. Componentes em `caixas-plasticas/_components/embalagens/`. A venda é receita: entra no faturamento e no lucro do Início. **Custo:** tipo com controle de estoque grava o custo médio móvel na venda (`PackagingSale.unitCostAtSale`, `FinancialCalc.custoMedioMovel`, mesma regra do estoque de mercadoria) e o lucro desconta "Custo das embalagens vendidas". Entrada e saldo inicial exigem o custo de cada uma. Tipo sem controle vende com custo nulo (receita sem custo) — o "Resultado do mês" avisa quantas vendas estão assim (`embalagensSemCusto`). A entrada com custo gera a conta `COMPRA_EMBALAGEM` e pode ser desfeita em 24 h (toast "Desfazer"; o par sai do custo médio por `custoMedioDoTipo`). **Cancelar venda** (`EmbalagensService.cancelarVenda`, regra §3.13): `PackagingSale.cancelledAt`, sai dos totais (toda soma de `packaging_sales` filtra `cancelledAt IS NULL`), e a baixa volta por AJUSTE `PACKAGING_SALE_CANCELLED` com o custo com que saiu. Nunca apagar movimento — era o que o "Excluir" antigo fazia. **Baixa** (`EmbalagensService.registrarBaixa`, botão "Baixa" no estoque do tipo, motivo obrigatório): QUEBRA `PACKAGING_LOSS` pelo custo médio do tipo, que entra em "Custo das embalagens (vendidas e baixadas)". Tem `idempotencyKey` e desfaz em 24 h (`desfazerBaixa`, AJUSTE `PACKAGING_LOSS_CANCELLED`; o par sai do custo médio e do custo do mês; recusa se o tipo teve movimento depois).

### Higienização (módulo `higienizacao`)

Envio → devolução parcial → pagamento parcial. Status ENVIADO → DEVOLVIDO → PAGO.

Editar e excluir o envio seguem a regra §3.13 (24 h do `createdAt`; o envio entra no lucro pela data de envio). Diminuir a quantidade ou excluir **não apaga** o movimento: entra `ESTORNO_SAIDA_HIGIENIZACAO`, que devolve às **sujas** e tira do higienizador (`computeCrateSaldo`).

### Cotações do CEASA (módulo `cotacoes`)

Preço do **boletim** da praça onde a empresa compra — referência de mercado, não preço do momento (o do momento é negociado no balcão e nenhuma central divulga). É o módulo com mais armadilhas do sistema; leia `docs/auditoria-2026-09-07.md` antes de mexer.

**As quatro tabelas do boletim são GLOBAIS, sem `tenantId`** (`ceasa_centrals`, `ceasa_products`, `ceasa_quotes`, `ceasa_import_runs`): o preço da praça é o mesmo para todos que compram ali, e copiá-lo por empresa multiplicaria a importação por número de clientes. Elas seguem o molde de `rate_limits` — `prisma` cru, fora de `TENANT_MODELS`. Só `tenant_ceasa_links`, `tenant_ceasa_link_recusas`, `tenant_ceasa_alertas` e `tenant_boletins_enviados` têm `tenantId`, e são a única superfície do módulo onde vazar dado entre clientes seria possível.

- **Importação:** adaptador por fonte (`src/lib/cotacoes/fontes/`, interface em `tipos.ts`, registro em `index.ts`). `buscar` faz I/O, `parse` é **puro** e testado contra fixture real. Três estados, não dois: ok / vazio (dia sem boletim, não alarma) / falha. Página sem o marcador esperado é **falha**, nunca vazio. Roda como sub-tarefa de `GET /api/cron/billing` (**13:30 BRT** — de manhã a praça ainda não publicou o boletim do dia).
- **Vínculo** (`tenant_ceasa_links`): produto do cliente ↔ produto do boletim **+ embalagem** (`unit`, anulável = "qualquer"). Manual por desenho: "Tomate" ≠ "Tomate cereja" são preços diferentes. `sugerirVinculos` só ordena. Nome **idêntico** (escore 1) é gravado sozinho por `autoVincularIdenticos` (ao abrir a tela e ao cadastrar produto, só com o módulo) — **exceto** produto cujo vínculo o dono removeu: `desvincular` grava `TenantCeasaLinkRecusa`, e vincular à mão a apaga. Sem a marca, a remoção não durava.
- **Alertas** (`tenant_ceasa_alertas`): por produto **e embalagem**. Nunca criados automaticamente — ver Armadilhas.
- **Telas:** `/cotacoes` (grade), `/cotacoes/comecar` (partida em 3 passos), `/cotacoes/vincular` (revisão em lote), `/cotacoes/produto/[id]` (histórico, comparativo, alerta), `/admin/cotacoes` (situação das praças + envio manual).
- **Fora do módulo:** o boletim aparece como referência **somente-leitura** na Compra e no PDV, e no Início (cartão de interesse, estoque parado com preço em queda, "comprei acima do boletim"). Todas essas telas são de núcleo, então o gate é `isModuleEnabled(session.modules, "cotacoes")` no servidor, nunca só esconder.
- **Colagem do super-admin em praça automática** só entra em dia que a busca não trouxe (`CotacoesImportService.conferirColagemManual`): para substituir um dia que veio do raspador, apague o boletim antes.
- **Envio pelo cliente** (`/cotacoes/enviar-boletim`, só em praça `manual`): vai para `tenant_boletins_enviados`, uma fila que só quem enviou vê, e o super-admin publica em `/admin/cotacoes`. Não é gravação direta — o porquê está no doc-comment de `cotacoes-envio.service.ts`. Desfazer publicação: `CotacoesImportService.apagarBoletim`.

**Cobertura de fontes, e o que trava o resto.** Praças com raspador hoje: as 7 da CEASAMINAS + Grande Vitória (adaptador `ceasaminas`) e a **CEAGESP São Paulo** (`ceagesp`, só o código `SPCEA` — as outras 11 unidades "CEAGESP" do catálogo são servidas por `/cotacoes/interior/`, que não foi medida). As demais dependem de envio manual.

Foram sondadas e **descartadas por publicarem só PDF** — o projeto não tem extrator de PDF, e um parse de layout de PDF é justamente o tipo de leitura que quebra em silêncio:

| Praça | Onde o boletim está | Por que não tem adaptador |
|---|---|---|
| CEASA-RJ | índice HTML → `.../arquivos_paginas/Boletim diário de preços DD MM AAAA.pdf` | preço só no PDF |
| CEASA-SC | `index.php?option=com_docman&view=documents&format=json&search=DD-MM-AAAA` → `links.file.href` | o JSON é índice de documento; preço só no PDF |
| CEASA-GO | post do WordPress com a lista mensal de `.../DD-MM-AAAA.pdf` | idem |
| CEASA-PR, CE, PE | — | host inalcançável na sondagem (TLS/timeout/conexão recusada) |

CONAB/PROHORT é a de maior alavancagem (acenderia dezenas de praças), e **não é "só um adaptador"**: ela é série `NACIONAL`, e a série é função pura do `sourceKey` da praça — ver a última armadilha do §15.

### CeasaNews (módulo `ceasanews`, `/ceasanews`)

Notícias que mexem no mercado de hortifruti (CEASAs, preços, clima, frete, safra), de veículos de terceiros: título, resumo curto, fonte e link para a matéria — nunca o texto da matéria.

- **Fontes** em `src/lib/noticias/fontes.ts`: RSS de Canal Rural, g1 Agronegócios, Compre Rural e Agência Brasil (Economia), mais buscas do **Google Notícias**. Conab, HF Brasil/Cepea, Notícias Agrícolas e Embrapa não têm feed acessível (o Google Notícias os cobre); Agrolink tem feed parado em 2020. Feed novo: sondar antes (200 com itens recentes).
- **`parse.ts` é puro** (RSS 2.0 + Atom, `fast-xml-parser`), testado contra feeds reais em `tests/fixtures/noticias/`. Sai **texto puro** — a tela nunca usa `dangerouslySetInnerHTML`; imagem só `https:`.
- **`filtro.ts` é puro:** termo forte (ceasa, hortifruti, hortaliça…) entra sozinho; fora isso precisa de alimento de balcão **e** algo que mexa no preço (preço, clima, logística, safra, economia). Termos negativos derrubam. Os feeds gerais deixam passar só a minoria — é o esperado.
- **Tabelas globais** (`noticias`, `noticias_coletas`), `prisma` cru, fora de `TENANT_MODELS`. Dedupe por `url` **e** por `chaveTitulo` (a mesma matéria vem do site e do Google). Guarda 30 dias; a tela mostra 7.
- **Coleta:** sub-tarefa do cron de billing (depois das cotações, `.catch` próprio) e sob demanda ao abrir a tela, via `after()`, se a última tiver mais de 2 h. Feed isolado falhando não avisa; **todos** falhando gera `NOTICIAS_FALHA`. Situação por feed e "Coletar agora" em `/admin/cotacoes`.
- "Sobre os seus produtos" casa a notícia com a família (primeira palavra) dos produtos ativos da empresa — o dado da empresa entra só na hora de ler.

### Relatórios (`/relatorios`, `GET /api/reports/[type]/export`)

Filtro de período. Imprimir/PDF e Excel. Tipos em `src/lib/reports/report.types.ts`. Básicos sempre; avançados atrás de `relatorios_avancados`; os de módulo opcional (caixas, higienização, embalagens, papelão) pedem **também** o módulo dono (`modulosDoRelatorio`, conferido na página e na exportação). Novo relatório: tipo + `buildReport` — o hub/export entram sozinhos. `FIADO_PERDAS` (básico) lista baixas e recuperações por data; `EMBALAGENS` tem custo e lucro por venda. "Contas pagas" soma o pago ao higienizador **sem gate de módulo**, como o fluxo de caixa (dinheiro pago é fato).

**Vendas por cliente.** O relatório `VENDAS` aceita `cliente` (o nome; a identidade é `chaveDoCliente`, a mesma da aba Clientes): vira o **extrato** do cliente, uma linha por item (`lineTotal`) mais a linha negativa "Desconto da venda" — as linhas de cada venda somam o `totalAmount` dela (`src/lib/reports/vendas-do-cliente.ts`). O preset `tudo` ("Todo o período") só vale nesse caso (`presetDoRelatorio`); nos outros cai em "mes". **Comprovante de uma venda:** `GET /api/vendas/[id]/comprovante?format=pdf|excel` (`buildComprovanteVenda`, núcleo, sem gate; venda de outra empresa é 404), com a identificação no `ReportResult.cabecalho`. Os botões (`BotoesDeExportacao`) ficam no relatório filtrado e na ficha do cliente. Resposta e registro em `report_exports` passam por `respostaDeArquivo`.

### Atividades (removida)

A tela `/atividades` saiu no commit `f644e78` e não existe mais. A auditoria continua sendo gravada (`audit()`), mas só o super-admin a lê, em `/admin/auditoria`. Se voltar uma lista por empresa, ela precisa recusar `tenantId` vazio antes de consultar — a versão antiga (`listForTenant`) devolvia a auditoria de todas as empresas nesse caso.

### Ajuda / tutorial

`/ajuda` é página de uso, **não** está no menu principal. O header tem botão Tutorial (página de uso + tour guiado). Logout está na sidebar / menu Mais, não no header.

### Configurações / Meu plano

`/configuracoes` em abas: Empresa, Meu perfil, **Meu plano** (`?aba=plano`: módulos, uso, troca de plano — `MeuPlanoConteudo`) e Assinatura (pagar, cancelar). "Meu plano" saiu do menu. `/plano` só redireciona para `/configuracoes?aba=plano`, preservando `?bloqueado=` — proxy, `requireModulo` e relatórios continuam mandando para `/plano?bloqueado=<módulo>`.

---

## 10. Super-admin (`/admin`)

- Visão: empresas, MRR, status, novos no mês.
- Clientes: cria empresa+OWNER numa transação (senha temporária, assinatura suspensa até 1º pagamento, categorias padrão). Ativar / suspender / bloquear (revoga sessões).
- Planos: preço, módulos, ativo. Excluir só se nenhuma assinatura usa; senão desativar.
- Pagamentos e auditoria global.

Cadastro público é o outro caminho de aquisição (trial). Empresas do admin **não** ganham trial.

---

## 11. PWA, SEO, legal

- PWA: `src/app/manifest.ts`, `public/sw.js` (cache de assets), `pwa-register` em produção. Offline: `/offline` e `/consulta-offline` (snapshot no aparelho; limpar no logout e ao abrir `/login`).
- O SW é registrado como `/sw.js?v=<build>` (`CEASAPRO_SW_VERSION` em `next.config.ts`: `VERCEL_DEPLOYMENT_ID` → SHA → horário do build). Endereço novo = SW novo a cada deploy, e o `activate` apaga os caches `ceasapro-*` de outros builds. O snapshot tem `schemaVersion` (`src/lib/pwa/snapshot.ts`): mudou o formato, suba a versão.
- Push: `PushSubscription` por usuário/endpoint; cron `/api/cron/avisos`. Endpoint só de serviço de push conhecido (`ehServicoDePush`: FCM, Mozilla, WNS, Apple) — `https` qualquer virava SSRF pelo cron — e no máximo `MAX_INSCRICOES_POR_USUARIO` (10) por pessoa. Endpoint que já é de outra pessoa só muda de dono com as **mesmas chaves** (`p256dh`/`auth`) — o celular compartilhado reenvia a mesma inscrição; quem só conhece o endereço não toma os avisos de outra empresa.
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
    cotacoes/           regras puras do boletim (nome, embalagem, frescor,
                        variação, gráfico, alerta, csv) + fontes/ (raspadores)
    storage/            Cloudflare R2 (fotos de produto)
    imagem/             formato (magic bytes) + compressão no aparelho
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

UI: tokens em `globals.css`. Variantes de botão: `default` (verde), `success`, `info` (azul), `violet`, `warning`, `destructive`, `outline`. **Ação é botão escrito e colorido, não ícone solto**: Editar = `info`, Excluir/Remover = `destructive`, Pagar/Vender/Salvar = `success`. Exceção: o + e − de quantidade do PDV. Listas no celular = cards; desktop = tabela + sidebar. **A ação principal de cada módulo** (Novo produto, Nova venda, Novo fiado, Novo fornecedor, Nova despesa, Novo envio, Nova venda de embalagem) é o cartão verde `CartaoDeAcao` (`src/components/ui/cartao-de-acao.tsx`) logo abaixo do `PageHeader`, não botão pequeno no cabeçalho; sem `data-tour` próprio ele é o alvo `acao-da-tela` do tour.

---

## 13b. Desempenho

- **O custo do app é o NÚMERO de idas ao banco por tela**, não uma consulta lenta: em produção o pool é pequeno (`connection_limit`) e cada `include` do Prisma é mais uma volta. Antes de acrescentar leitura numa tela, veja se ela já foi lida (layout, serviço vizinho). Leitura repetida na mesma requisição → `cache()` do React, **só em caminho de leitura** (ação que muda o dado lê por conta própria). Ver `getInteresses`, `centralParaLeitura`.
- **Cache no Upstash Redis** (`src/lib/cache/`), entre requisições e instâncias. `lembrar({ chave, versoes, ttlSeg }, fn)`:
  - **Só leitura, nunca fonte.** Escrita, saldo usado numa escrita, decisão de segurança e o PDV (`/vendas/nova`, exceto a referência do boletim) leem do banco. Não grave saldo no Redis.
  - **Invalidação por versão:** a chave leva `v:t:<empresa>` (e/ou `v:g:cotacoes|noticias|catalogo`). Os wrappers de escrita da empresa incrementam a versão depois do handler (também quando ele lança; GET de rota não). Fora deles, ver §3 regra 5b. Leitura que depende do dia leva `isoDateTz()` na chave.
  - **Fail-open:** sem env, com erro ou com mais de 150 ms, é só `fn()`. O valor volta pelo codec (`Decimal`/`Date`/`bigint` preservados).
  - **Onde está:** sessão dos layouts (`sessaoAindaValidaParaLeitura`, 30 s, versões de usuário/empresa/linhagem que toda revogação incrementa — os wrappers continuam com `sessaoAindaValida` no banco), cabeçalho do layout `(app)`, `DashboardService.getSummary` (60 s; `calcularSummary` é o cálculo sem cache), `CotacoesService` (`getPainel`, `getMeusProdutos`, `precosDoBoletimPorProduto`, `comprasAcimaDoBoletim`, `listarCentrais`), `NoticiasService.listar`, `CatalogoImagensService.buscar`/`paraIlustrar`.
  - **Rate limit:** `rate-limit-db.ts` conta no Redis e cai no Postgres se ele falhar (o fail-closed é do banco). O throttle por empresa das rotas (`rateLimitCompartilhado`) cai no contador em memória.
  - **Testes:** `tests/setup/no-outbound-http.ts` apaga as variáveis do Upstash; teste de cache usa `definirClienteDeCache(clienteEmMemoria())`.
- **Função e banco na mesma região:** Vercel em `gru1` (`vercel.json`, exige o plano Pro) e Neon em `sa-east-1`. Em continentes diferentes cada ida ao banco custa ~120 ms e nenhuma otimização de consulta compensa.
- **Medir:** `PRISMA_CONTAR_CONSULTAS=1 npm run dev` imprime uma linha por consulta. Em produção, consulta acima de `PRISMA_SLOW_MS` (padrão 300 ms) vira log `Consulta lenta`, e o Neon tem `pg_stat_statements` ativo (`SELECT … FROM pg_stat_statements ORDER BY total_exec_time DESC`).
- **`getSummary` recebe a aba** (`geral`/`financeiro`/`resumo`); sem ela calcula tudo.
- **Nada de servidor no navegador.** Componente `"use client"` não importa `@/lib/money` (traz o runtime do Prisma) nem módulo com `node:crypto`/`jose`: use `@/lib/numero`, `@/lib/format`, `@/lib/estoque/nivel`, `@/lib/cotacoes/embalagem-texto`, `@/lib/auth/google-erros`. `google-oauth.ts` é `server-only`.
- **PDV:** cartões da grade em `memo` com callbacks estáveis e busca com `useDeferredValue`. Callback novo para o cartão tem de ser estável (`useCallback` + `setCart` funcional), senão todo cartão redesenha a cada tecla.
- **Livro-razão continua a regra** (§3.4). O índice `stock_movements (tenantId, productId, createdAt, id)` é a ordem exata da janela do custo médio — não reordenar a janela sem reordenar o índice.
- **Checkpoint do custo médio** (`stock_cost_checkpoints`): o repasse de `sqlCustoEstoque` começa do estado gravado até `ateCreatedAt` (saldo, média sem arredondar, última entrada, último `movedAt`) e lê só os movimentos posteriores. Tabela **derivada** — apagar não muda número nenhum, só deixa a conta mais cara. O cron de billing avança os checkpoints (corte de 7 dias, sempre além do prazo de desfazer); `npx tsx scripts/recalcular-checkpoints.ts` recalcula do zero (rodar depois do deploy que criou a tabela). Mudou a regra do custo? Recalcule os checkpoints, senão o número velho fica embutido neles. `tests/integration/estoque-checkpoint.test.ts` compara com e sem checkpoint. O checkpoint guarda também o `deslocamento` (saldo em que o ciclo atual da média recomeçou): sem ele, um checkpoint positivo dentro de um ciclo que recomeçou num saldo negativo errava a média. A migration `20261024120000_varredura_21_10` apaga os checkpoints antigos — o cron os refaz.
- **Carga:** `tests/load/` (seed de 100 empresas + k6). Ver `tests/load/README.md`.

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
- `addOneMonth` próprio — `setMonth` nativo vaza 31/01 → março. E a renovação vai pelo **dia âncora** (`TenantSubscription.diaAncora`), nunca pelo vencimento já ajustado: partir dele fazia 31/01 → 28/02 → 28/03 para sempre.
- `currentPeriodEnd` **ignorado** enquanto `activatedAt` é nulo (não virar trial eterno).
- Testes E2E de layout: cartões visíveis estão em `main .bg-card` (o `aside` também tem `bg-card` e é o primeiro match).
- Páginas públicas estáticas quebram CSP (`force-dynamic`).
- Dois `next dev` no Windows travam Prisma.
- **Despesa de compra fora do lucro.** Toda compra gera `Expense` com `origem = COMPRA`. Qualquer soma nova de despesas que meça custo operacional (lucro, margem, Fixas/Variáveis) precisa filtrar `origem = 'MANUAL'`; quem mede dinheiro devido ou pago (contas a pagar, caixa) inclui tudo. Errar o lado conta a mercadoria duas vezes ou some com a dívida do fornecedor.
- **Compra cancelada continua em `purchases`.** Toda soma ou "última compra" nova precisa de `cancelledAt IS NULL` (além de `deletedAt`), como a venda. Esquecer conta mercadoria de uma compra que não existiu — e o "último preço pago" passa a ser o preço digitado errado.
- **Desfazer não apaga movimento.** Venda cancelada devolve com `AJUSTE` (`SALE_CANCELLED`); compra cancelada estorna com `AJUSTE` negativo (`PURCHASE_CANCELLED`), que `sqlCustoEstoque` reconhece pelo texto e tira do custo junto com a entrada. Trocar o `sourceType` sem `src/lib/estoque/origens.ts` faz o preço errado voltar à média em silêncio.
- **"Sobrou no mês" aparece nas DUAS abas do Início.** `getSummary` com `parte = "geral"` também calcula tudo o que entra no lucro (CMV, contas, higienização, embalagem) — pular isso para economizar consulta fez o cartão mostrar o próprio "Vendi" como lucro.
- **Foto de produto não sobe crua.** Celular gera 3–8 MB; Server Action aceita 1 MB e a Vercel 4,5 MB. Sempre `comprimirFoto` antes, e o servidor confere magic bytes (o bucket é público).
- **Só 2 crons.** O projeto nasceu no Hobby da Vercel, que aceita dois agendamentos (um terceiro faz o **deploy** falhar, não o cron). É por isso que a importação de cotações, a coleta do CeasaNews e os checkpoints de custo pegam carona no cron de billing. Hoje o projeto pressupõe o Pro (`regions: ["gru1"]` exige), que libera mais crons — mas mover tarefa de cron é mudança à parte.
- **Movimento de estoque é só acrescentado.** O checkpoint do custo médio supõe que nada com mais de 7 dias é apagado nem alterado no livro-razão, e que todo estorno sai em até 24 h. Corrigir movimento antigo à mão no banco exige `scripts/recalcular-checkpoints.ts` para a empresa; aumentar `HORAS_PARA_DESFAZER` além do corte (`IDADE_MINIMA_CHECKPOINT_MS`) quebra o custo em silêncio.
- **Login: o balde só por IP conta falhas.** `login:ip:<ip>` (60 / 15 min, contra password spraying) é **consumido** atomicamente antes do Argon2 (`rateLimitDb`) e a unidade é **devolvida** no acerto (`devolverUnidadeDb`). Consultar antes e registrar a falha depois deixava passar todas as tentativas em paralelo; consumir sem devolver barrava o 61º box atrás do mesmo Wi-Fi do CEASA; zerar no acerto deixaria quem tem UMA conta válida continuar testando senhas.
- **Não criar alerta de cotação automaticamente.** `push-avisos.service.ts` manda o push diário sempre que existe QUALQUER aviso pendente. Alerta em cada produto vinculado transforma a notificação de "só quando há algo a tratar" em "todo dia, para sempre" — e quem desliga isso perde junto o aviso de fiado vencido.
- **`ceasa_quotes.unit` é texto livre da fonte** (`KG`, `CX 30 DZ`, `DZ 4 KG`, `UN 1,5 KG`). O peso em quilo só existe quando a **própria fonte** o declara no texto; `pesoEmKg` devolve `null` no resto, e é para continuar assim — R$/kg inventado é o preço errado com cara de certo.
- **No vínculo, `unit = NULL` ≠ `unit = ''`.** `NULL` é "o cliente não escolheu embalagem" (vale para todas); `''` é uma embalagem real, que a praça manual grava quando o boletim não traz a coluna. No `<select>` da tela, "qualquer embalagem" precisa de um valor-sentinela, nunca `""`.
- **Não existe caminho de despublicar cotação**, e a tela mostra `MAX(quoteDate)`: dado ruim em praça manual é permanente até chegar um boletim com data posterior — o que, numa praça manual, não acontece sozinho.
- **`buscarHtml` se identifica como `CeasaProBot/1.0`, e algumas fontes recusam** (a CONAB devolve 403 nesse UA e 200 no de navegador). `valeRepetir` não repete 4xx, então isso vira `FALHA` limpa com aviso ao super-admin — mas o adaptador precisa decidir isso de propósito.
- **A série é função pura do `sourceKey` da praça** (`serieDaFonte`), e toda leitura filtra por ela. Gravar cotação de outra série numa praça existente produz dado que **nenhuma tela lê**; trocar o `sourceKey` de uma praça com histórico faz o histórico antigo desaparecer da tela e os alertas salvos pararem de disparar em silêncio.

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
| Cotações: o que já mordeu | [`auditoria-2026-09-07.md`](auditoria-2026-09-07.md) |
| Auditoria E2E + pendências | [`auditoria-2026-09-23.md`](auditoria-2026-09-23.md) |
| Auditoria de bugs dos módulos (2ª rodada) | [`auditoria-2026-09-30.md`](auditoria-2026-09-30.md) |
| Auditoria de ponta a ponta + pendências (3ª rodada) | [`auditoria-2026-10-18.md`](auditoria-2026-10-18.md) |
| Vercel + Neon | [`09-deploy-vercel.md`](09-deploy-vercel.md) |
| PWA | [`10-pwa-evolucao.md`](10-pwa-evolucao.md) |
| Next 16 (breaking) | `AGENTS.md` + `node_modules/next/dist/docs/` |
