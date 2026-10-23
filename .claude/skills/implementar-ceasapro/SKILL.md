---
name: implementar-ceasapro
description: Roteiro para implementar funcionalidade no CeasaPro do model à tela — tenant, validação, service, Server Action ou route handler, tela, menu, módulo pago e relatório. Use ao criar ou alterar tela nova, página, CRUD, cadastro, model Prisma, migration, Server Action, route handler, rota de API, módulo opcional, relatório, menu ou navegação.
---

# Implementar no CeasaPro

Esta skill é a dona das regras de camada, tenant e envelope. Dinheiro e estoque: skill `dinheiro-e-estoque`. Plano, cobrança, módulo pago e cron: skill `cobranca`. Cotações e CeasaNews: skill `boletim`.

Next.js 16: leia o guia em `node_modules/next/dist/docs/` antes de usar API nova. O porteiro é `src/proxy.ts`, não `middleware.ts`.

## Regra de ouro do tenant

O `tenantId` vem **só da sessão** — `ctx.tenantId` dos wrappers (`requireTenant` em `src/lib/auth/session.ts`). Nunca leia `tenantId` do body, query, params ou formulário. Schema Zod de entrada não tem campo `tenantId`.

## Ordem

Siga na ordem. Pule o passo que não se aplica, mas não o reordene.

### 1. Model e migration

- Em `prisma/schema.prisma`: `tenantId`, `createdAt`/`updatedAt`, e `deletedAt` se couber soft delete. Dinheiro e quantidade em `Decimal`.
- Gere a migration em `prisma/migrations/` (`npx prisma migrate dev --name <nome>`). Não suba o Prisma para v7.

### 2. Registro de tenant

- Inclua o model em `TENANT_MODELS` em `src/lib/db/models-tenant.ts`; com `deletedAt`, também em `SOFT_DELETE_MODELS`. Nome em PascalCase, como no schema.
- Inclua o `deleteMany` dele em `cleanupTenants` de `tests/helpers/factory.ts`, antes dos models que ele referencia.
- `tests/unit/models-tenant-cobertura.test.ts` cobra o primeiro; `tests/integration/tenant-isolation.test.ts` é o teste de segurança.
- Tabela global por desenho (boletim, notícias, catálogo de fotos, `rate_limits`) fica fora da lista e usa `prisma` cru com justificativa no doc-comment.

### 3. Validação

- Um schema Zod só, em `src/lib/validations/<dominio>.ts`, usado no cliente (React Hook Form) e no servidor. O servidor sempre revalida.
- Datas de formulário: `parseFormDateTz` de `src/lib/tz.ts`.

### 4. Service

- Em `src/lib/services/<dominio>.service.ts`. Recebe dado validado + `tenantId`. Regra de negócio mora aqui, não na rota.
- Banco por `getTenantPrisma(tenantId)` (`src/lib/db/tenant-prisma.ts`). A extensão injeta `tenantId` e `deletedAt: null` e **recusa** operação que não conhece (`isKnownTenantOp`).
- Toca 2+ tabelas: `prisma.$transaction`, com `audit()` (`src/lib/audit.ts`) **dentro** da transação.
- Erro de negócio: `AppError` e subclasses de `src/lib/http/app-error.ts`.

### 5a. CRUD simples → Server Action

- Em `src/actions/<dominio>.actions.ts`, com `withTenantAction({ schema, module?, handler })` de `src/lib/http/with-action.ts`. O wrapper faz sessão, epoch, assinatura ativa, módulo e `schema.parse`. Handler fino: chama o service.
- No cliente, chame pela `chamarAction` (`src/lib/http/chamar-action.ts`), que renova a sessão antes da escrita.

### 5b. Fluxo transacional → Route Handler

- Em `src/app/api/<dominio>/route.ts`, com `withTenantRoute({ schema, source?, module?, allowInactive?, handler })` de `src/lib/http/with-route.ts`. O wrapper recusa outra origem (`assertMesmaOrigem`, 403) e corpo JSON sem `Content-Type: application/json` (415), aplica rate limit por empresa e devolve `{ ok, data }`.
- `allowInactive` só em rota de regularização de cobrança.
- Lançamento que pode ser reenviado: `idempotencyKey` com `comIdempotencia` (`src/lib/http/idempotencia.ts`).

### 6. Tela

- Em `src/app/(app)/<rota>/page.tsx`, com `PageHeader` e `Card`. Mobile-first: lista vira card no celular, tabela no desktop.
- A ação principal do módulo é `CartaoDeAcao` (`src/components/ui/cartao-de-acao.tsx`) logo abaixo do `PageHeader`, não botão pequeno no cabeçalho.
- Ação é botão escrito e colorido: Editar = `info`, Excluir/Remover = `destructive`, Pagar/Vender/Salvar = `success`.
- Componente `"use client"` não importa `@/lib/money` nem módulo com `node:crypto`/`jose` (ver skill `dinheiro-e-estoque`).
- Página que lê a mesma coisa duas vezes na requisição: `cache()` do React, só em leitura.
- Leitura pesada e repetida entre aberturas (painel, lista global): `lembrar({ chave, versoes: [versao.tenant(tenantId)], ttlSeg }, fn)` de `src/lib/cache/cache.ts`. Chave sempre com o `tenantId`; dia na chave se o número muda à meia-noite. Nunca em escrita nem em saldo usado para gravar. Escrita fora dos wrappers chama `invalidarTenant` (CONTEXTO-AGENTE §13b).

### 7. Navegação

- Link em `src/components/layout/bottom-nav.tsx` **e** em `src/components/layout/side-nav.tsx`. O menu filtra por `rotaLiberada`; isso é UX, não barreira.

### 8. Módulo pago

- Chave nova em `OPTIONAL_MODULE_KEYS` **e** entrada em `OPTIONAL_MODULES` (`src/lib/plan/modules.ts`, com `pathPrefixes`). O form de plano do admin lê a lista sozinho.
- `module: "<chave>"` em todo `withTenantAction` / `withTenantRoute` do módulo.
- `layout.tsx` da rota com `await requirePagina({ modulo: "<chave>" })` (`src/lib/auth/pagina.ts`). `tests/unit/paginas-module-gate.test.ts` e `actions-module-gate.test.ts` cobram.
- Tela de núcleo que mostra dado de módulo opcional confere `isModuleEnabled(session.modules, "<chave>")` no servidor.
- Regras de plano e período pago: skill `cobranca`.

### 9. Tela de dois módulos

- Caminho **exato** em `TELAS_COMPARTILHADAS` (`src/lib/plan/modules.ts`). Proxy e menu já perguntam por `modulosDaRota`/`rotaLiberada`.
- Cada subtela continua do módulo dono e tem o próprio `layout.tsx` com `requirePagina({ modulo })` — veja `src/app/(app)/caixas-plasticas/novo/layout.tsx`. As chaves não se juntam.

### 10. Relatório

- Tipo novo em `REPORT_TYPES` e rótulo em `REPORT_LABELS` (`src/lib/reports/report.types.ts`), valor novo no enum `ReportType` de `prisma/schema.prisma` (com migration) e o caso em `buildReport` (`src/lib/reports/report.service.ts`).
- Básico: inclua em `BASIC_REPORTS`. Fora dela ele é avançado automaticamente (`isAdvancedReport`).
- Relatório que lê dado de módulo opcional: `MODULO_DO_RELATORIO`. Hub e exportação (`/api/reports/[type]/export`) entram sozinhos e conferem `modulosDoRelatorio`.

### 11. Página pública

- `export const dynamic = "force-dynamic"` na página (CSP com nonce por request; HTML estático sai sem nonce e o JS some).
- Prefixo em `PUBLIC_PREFIXES` de `src/proxy.ts`, com fronteira. Indexável? `PAGINAS_INDEXAVEIS` em `src/lib/seo/paginas-publicas.ts` (servido por `src/app/sitemap.xml/route.ts`).

### 12. Fuso e rótulos

- Data só por `src/lib/tz.ts` (`startOfDayTz`, `startOfMonthTz`, `isoDateTz`, `parseFormDateTz`…). Nunca `setHours`, `toISOString().slice(0,10)` ou `DATE_TRUNC` sem fuso.
- Valor de enum novo ganha rótulo em `src/lib/labels.ts` (`tests/unit/labels-cobertura.test.ts` cobra).

## Testes

- Tenant e envelope: `tests/integration/tenant-isolation.test.ts`, `tests/unit/models-tenant-cobertura.test.ts`, `with-action.test.ts`, `with-route.test.ts`, `rotas-envelope.test.ts`.
- Gate: `tests/unit/actions-module-gate.test.ts`, `paginas-module-gate.test.ts`, `proxy-matcher.test.ts`, `proxy-csp-e-bypass.test.ts`, `tests/e2e/modulo-bloqueado.spec.ts`.
- Tela e menu: `tests/e2e/navegacao.spec.ts`, `estados-de-tela.spec.ts`, `acessibilidade.spec.ts`.
- Relatório: `tests/unit/relatorios-grupos.test.ts`, `report-exporters.test.ts`, `tests/e2e/relatorios-export.spec.ts`.
- Fuso e rótulos: `tests/unit/timezone.test.ts`, `labels-cobertura.test.ts`.
- Mais os testes do domínio na skill correspondente.

Comandos: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npx playwright test <arquivo>`.

## Windows

- No PowerShell não use `&&`; encadeie com `;`.
- `prisma generate` dá EPERM se `next dev` estiver aberto (lock do engine). Feche o dev server antes.
- `npm run test:integration` recusa `DATABASE_URL` remoto (`tests/setup/guard-database.ts`) e **apaga dados** das empresas de teste. Rode só contra Postgres local.
