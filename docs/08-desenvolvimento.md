# 8. Desenvolvimento

Guia para quem vai manter ou evoluir o CeasaPro.

## Scripts npm

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Turbopack) |
| `npm run build` | `prisma generate` + `next build` (build de produção) |
| `npm start` | Servidor de produção |
| `npm run typecheck` | `tsc --noEmit` (checagem de tipos) |
| `npm run lint` | ESLint |
| `npm test` | Todos os testes (Vitest) |
| `npm run test:unit` | Só testes unitários |
| `npm run test:integration` | Só testes de integração (precisam do banco) |
| `npm run prisma:migrate` | `migrate dev` (criar/aplicar migration) |
| `npm run prisma:deploy` | `migrate deploy` (produção) |
| `npm run prisma:studio` | Prisma Studio (inspecionar o banco) |
| `npm run db:seed` | Popular dados iniciais |

## Testes

- **Vitest**, com dois grupos: `tests/unit/` (funções puras, sem banco) e `tests/integration/` (usam o Postgres do Docker; criam empresas próprias e limpam ao final).
- Cobertura atual de destaque:
  - `tests/unit/financial-calc.test.ts` — todas as fórmulas financeiras, incluindo precisão decimal e divisão por zero.
  - `tests/unit/plan-modules.test.ts` — catálogo de módulos e o guard `requireModule`.
  - `tests/integration/tenant-isolation.test.ts` — **isolamento por empresa** (segurança).
  - `tests/integration/vendas-flow.test.ts` — fluxo compra→estoque→venda→fiado→pagamento, com bloqueios de estoque/saldo.
  - `tests/integration/fase2-flow.test.ts` — caixas plásticas (saldos), higienização e embalagens.
- Rode com o banco de pé: `docker compose up -d && npm test`.

## Convenções

- **Camadas**: rota/action fino → service (regra) → Prisma. Fórmulas financeiras só no `FinancialCalcService`.
- **Isolamento**: nos módulos de negócio use sempre `getTenantPrisma(tenantId)`; nunca `prisma` cru. O `tenantId` vem da sessão.
- **Dinheiro**: `Decimal` (helpers em `src/lib/money.ts`); formatação só na borda (`src/lib/format.ts`, `formatBRL`).
- **Validação**: um schema Zod por entidade em `src/lib/validations/`, usado no cliente (RHF) e no servidor (dentro do wrapper).
- **Respostas/erros**: retorne via `ActionResult`; lance `AppError`/subclasses (nunca `throw` genérico com dado sensível).
- **Rótulos em PT**: enums → texto em `src/lib/labels.ts`.
- **Transações**: qualquer operação que toca 2+ tabelas usa `prisma.$transaction`, com `audit()` dentro.

## Como adicionar um novo módulo de negócio (CRUD simples)

1. **Schema Prisma**: adicione o model (com `tenantId`, timestamps, soft delete). Rode `npm run prisma:migrate`.
2. **Isolamento**: inclua o nome do model em `src/lib/db/models-tenant.ts` (`TENANT_MODELS` e, se aplicável, `SOFT_DELETE_MODELS`) e no cleanup de `tests/helpers/factory.ts`.
3. **Validação**: crie o schema Zod em `src/lib/validations/`.
4. **Service**: crie `src/lib/services/<dominio>.service.ts` usando `getTenantPrisma` + `audit()`.
5. **Actions**: `src/actions/<dominio>.actions.ts` com `withTenantAction({ schema, handler })`. Se for módulo opcional pago, passe `module: "<chave>"`.
6. **Telas**: em `src/app/(app)/<dominio>/` (lista + form). Reutilize `PageHeader`, `Card`, `DeleteButton`, inputs de `components/forms/`.
7. **Navegação**: adicione o link em `bottom-nav.tsx` e `side-nav.tsx`.

## Como tornar um módulo "opcional" (pago por plano)

1. Adicione a chave em `OPTIONAL_MODULES` (`src/lib/plan/modules.ts`), com `pathPrefixes` (para o middleware) ou trate por outro critério.
2. Passe `module: "<chave>"` nas actions/rotas do módulo (barreira de servidor).
3. Inclua a chave nas checkboxes do formulário de plano (já é automático: o form lê `OPTIONAL_MODULE_KEYS`).
4. A navegação e o middleware passam a respeitar automaticamente. Ver [Planos e módulos](05-planos-e-modulos.md).

## Como adicionar um relatório

1. Adicione o tipo em `REPORT_TYPES` e o rótulo em `REPORT_LABELS` (`src/lib/reports/report.types.ts`); classifique em `BASIC_REPORTS` ou `ADVANCED_REPORTS`.
2. Implemente o `case` no `buildReport` (`src/lib/reports/report.service.ts`) retornando um `ReportResult` (colunas + linhas + totais).
3. Pronto: aparece no hub, na visualização e na exportação Excel automaticamente. Avançados já ficam atrás do módulo `relatorios_avancados`.

## Design system / UI

- Componentes base em `src/components/ui/` (button, card, input, select nativo, dialog, sheet, tabs, table, badge, skeleton, sonner). Tokens de cor (verde CEASA) e tema claro/escuro em `src/app/globals.css`.
- Padrões de dados em `src/components/data/` (PageHeader, EmptyState, StatCard, SalesChart, AuditList) e CRUD em `src/components/crud/` (DeleteButton).
- Mobile-first: no celular, listas viram cards + menu inferior; no desktop, barra lateral.

## PWA

- `src/app/manifest.ts` (manifest), `public/sw.js` (service worker leve — cacheia só assets), `src/components/pwa-register.tsx` (registro só em produção). Ícones gerados por `node scripts/generate-icons.mjs`. O `middleware` exclui `sw.js`/`manifest.webmanifest`/`icons`.

## Notas de plataforma

- **Prisma v6** (não subir para v7 sem migrar para `prisma.config.ts` + driver adapters).
- **Next 16**: o `middleware.ts` funciona, mas o Next sinaliza migração futura para `proxy.ts`.
- **Windows + OneDrive**: pode travar arquivos de `node_modules/.prisma`; evite dois servidores simultâneos; em erro `EPERM`, feche o servidor e rode `npx prisma generate`.
