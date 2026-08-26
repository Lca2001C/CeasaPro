# 2. Arquitetura

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | **Next.js 16** (App Router) — um único app full-stack (frontend + backend juntos) |
| UI | **React 19**, **Tailwind CSS 4**, componentes próprios no estilo shadcn/ui + Radix (dialog, tabs), ícones `lucide-react`, toasts `sonner` |
| Linguagem | **TypeScript** (tipagem forte em todo o projeto) |
| Banco de dados | **PostgreSQL** via **Prisma ORM** (v6) |
| Formulários/validação | **React Hook Form** + **Zod** (o mesmo schema valida no cliente e no servidor) |
| Dados no cliente | **TanStack Query** (onde há interatividade) e **Zustand** (estado de UI simples) |
| Autenticação | Própria, com **`jose`** (JWT) e **Argon2id** (`@node-rs/argon2`) |
| Pagamentos | **Mercado Pago** (mensalidade via PIX) |
| E-mail | **SMTP do Gmail** via nodemailer (recuperação de senha, recibo, lembrete de vencimento) |
| Relatórios | **exceljs** (Excel) + impressão do navegador (PDF) |
| Logs | **pino** (com redação de dados sensíveis) |
| Testes | **Vitest** |

> **Por que um app único (e não o monorepo Next.js + NestJS da especificação original)?** Simplicidade: um repositório, um deploy, muito menos configuração. Mantivemos o "modular por domínio" colapsando *controller + service* do NestJS em *Server Action/Route Handler (fino) + Service (regra)*.

## Camadas

O código respeita três camadas bem separadas:

```
Rota / Action (fino)      → valida entrada (Zod), obtém a sessão/tenant, delega. Sem regra de negócio.
Service (regra)           → toda a lógica de negócio; recebe dados já validados + tenantId.
Prisma (dados)            → acesso ao banco (sempre via cliente isolado por tenant nos módulos de negócio).
```

- **Server Actions** são o padrão para CRUD simples (produtos, fornecedores, despesas, configurações, onboarding, super-admin).
- **Route Handlers** (`/api/*`) são usados nas áreas transacionais e que "crescem": vendas/PDV, compras, movimentos de estoque, pagamentos de fiado, exportação de relatórios, webhook do Mercado Pago, cron e refresh de token.
- Ambos compartilham os mesmos "envelopes": `withTenantAction`/`withAdminAction` e `withTenantRoute`/`withAdminRoute`, que centralizam sessão + validação + tratamento de erro + resposta padronizada (`ActionResult`).

**Regra de ouro do financeiro:** todas as fórmulas monetárias ficam em um único serviço — `FinancialCalcService` ([`src/lib/services/financial-calc.service.ts`](../src/lib/services/financial-calc.service.ts)). Nenhuma fórmula é duplicada em outro lugar.

## Multi-tenancy (isolamento por empresa)

O coração da segurança de dados. Em [`src/lib/db/tenant-prisma.ts`](../src/lib/db/tenant-prisma.ts), `getTenantPrisma(tenantId)` retorna um Prisma Client "escopado" via `$extends` que **injeta automaticamente**:

- `where.tenantId` + `where.deletedAt = null` em toda leitura;
- `data.tenantId` em toda criação;
- `where.tenantId` em updates/deletes.

Assim é **impossível esquecer** o filtro por empresa nos módulos de negócio. A lista de models que têm `tenantId`/soft delete está em [`src/lib/db/models-tenant.ts`](../src/lib/db/models-tenant.ts). O `prisma` "cru" só é usado em auth, super-admin, billing/webhooks e auditoria.

> O `tenantId` vem **sempre da sessão verificada (JWT)** — nunca de um parâmetro enviado pelo cliente.

## Autenticação (resumo)

- Login por e-mail/senha; senha com **Argon2id**.
- **Access token** (JWT curto, ~15 min) em cookie `httpOnly/Secure/SameSite=Lax`.
- **Refresh token** opaco, guardado com hash em `refresh_tokens`, rotacionado a cada uso e revogável (logout, troca de senha, bloqueio de empresa).
- O token carrega *claims* de `role`, `tenantId`, `tenantStatus`, `subStatus` e `modules` (módulos do plano). O `middleware.ts` (Edge) usa esses claims para rotear e bloquear sem tocar no banco.

Detalhes em [Segurança](06-seguranca.md).

## Fronteiras de execução (Edge x Node)

- O `middleware.ts` roda no **Edge** — só verifica o JWT (via `jose`, que é edge-safe) e decide rota/bloqueio. Não acessa o banco.
- Hashing de senha (Argon2), Prisma, geração de Excel e chamadas ao Mercado Pago rodam no **Node** (rotas com `export const runtime = "nodejs"`).

## Estrutura de pastas (visão macro)

```
src/
  app/
    (auth)/         login, recuperar-senha           (público)
    (app)/          área da empresa (OWNER) + AppShell + navegação
    (admin)/        painel do super-admin
    onboarding/     assistente de 1º acesso
    assinatura/, conta/suspensa/   regularização (fora do (app))
    api/            route handlers (auth, vendas, compras, relatórios, webhooks, cron)
    manifest.ts     manifest do PWA
  actions/          Server Actions por domínio (handlers finos)
  lib/
    services/       regras de negócio por domínio (+ financial-calc central)
    db/             prisma singleton + getTenantPrisma + lista de models
    auth/           senha, jwt, sessão/guards, refresh, cookies, build-session
    http/           ActionResult, AppError, withAction, withRoute, request
    plan/           catálogo de módulos gateáveis + guards
    billing/        cálculo de status da assinatura
    payments/       cliente Mercado Pago + verificação de webhook
    reports/        contrato ReportResult, builders e exportador Excel
    validations/    schemas Zod (DTOs) por domínio
    labels.ts, format.ts, dates.ts, money.ts, logger.ts, constants.ts
  components/       ui/ (design system), layout/, data/, forms/, crud/
  middleware.ts     porteiro Edge (papel, assinatura, módulos)
prisma/             schema.prisma, migrations/, seed.ts
scripts/            inicialização (dev/prod, bash/PowerShell), geração de ícones
tests/              unit/ e integration/
docs/               esta documentação
```

Mais detalhes de convenções em [Desenvolvimento](08-desenvolvimento.md).

## Fuso horário

O servidor roda em **UTC** (Vercel) e o usuário está no **Brasil**. Toda data que o sistema exibe, agrupa ou compara passa por [`src/lib/tz.ts`](../src/lib/tz.ts), que fixa `America/Sao_Paulo`:

- **Exibição:** `formatDate`/`formatDateTime` declaram `timeZone` — sem isso, tudo renderizado no servidor saía 3 horas adiantado (a auditoria mostrava 15:27 para um evento das 12:27).
- **Limite do dia:** `startOfDay`/`endOfDay`/`startOfMonth` calculam a virada no fuso brasileiro. Com `setHours` puro o dia começava às 21h do dia anterior: uma venda das 22h caía no relatório do dia seguinte e o fechamento nunca batia com o do balcão.
- **Agrupamento por dia no banco:** as consultas de gráfico e de fluxo de caixa usam `DATE_TRUNC('day', col AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')`. As colunas são `timestamp` sem fuso guardando UTC, então truncar direto agrupava por dia UTC.
- **Mês de referência da mensalidade:** `refMonthTz`. Com `getMonth()` puro, quem pagasse depois das 21h de 31/08 recebia cobrança marcada como setembro, e agosto ficava em aberto para sempre.
- **Formulários:** o padrão "hoje" dos campos de data usa `isoDateTz()`. `new Date().toISOString().slice(0,10)` já devolvia amanhã às 21h.
- **Entrada de data:** `parseIsoDateTz` lê `"2026-08-26"` como o dia 26 **aqui** — `new Date("2026-08-26")` é meia-noite UTC, ou seja, 21h do dia 25.

Coberto por [`tests/unit/timezone.test.ts`](../tests/unit/timezone.test.ts), que fixa o comportamento nas bordas (23h30 e virada de mês).

## Padrões transversais

- **Respostas padronizadas:** `ActionResult<T>` = `{ ok: true, data }` ou `{ ok: false, error: { code, message, fields? } }`. O cliente sempre checa `res.ok`.
- **Erros:** classe `AppError` + subclasses (`ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `BusinessRuleError`, `PaymentRequiredError`) → mapeadas para status HTTP e mensagens amigáveis.
- **Dinheiro:** `Decimal(14,2)`; quantidades `Decimal(14,3)`; nunca `Float`. Helpers em [`src/lib/money.ts`](../src/lib/money.ts).
- **Consistência:** operações que tocam várias tabelas (venda, compra, pagamento de fiado, webhook) rodam em `prisma.$transaction` — ou tudo, ou nada.
- **Auditoria:** helper `audit()` grava em `audit_logs` dentro da mesma transação da operação.
