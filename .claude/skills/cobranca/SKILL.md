---
name: cobranca
description: Regras de cobrança, assinatura e plano do CeasaPro — status, trial, tolerância, Mercado Pago, webhook, módulos do período pago e cron de billing. Use ao mexer em assinatura, plano, troca de plano, módulo pago, gate de módulo, PIX, cartão, Payment Brick, Mercado Pago, webhook, trial, teste grátis, mensalidade, vencimento, graceDays, tolerância, estorno, chargeback, cron, features vigentes ou /assinatura e /plano.
---

# Cobrança

Esta skill é a dona das invariantes de assinatura, plano, módulo pago e cron. As outras skills remetem para cá.

## Antes de editar

Abra e leia:

1. `src/lib/billing/status.ts` — `computeStatus`, `accessDecision`, `billingNotice`, `inicioDoPeriodoPago`, `addOneMonth`, `TRIAL_DAYS`.
2. `src/lib/plan/features-vigentes.ts` — `featuresVigentes`, `modulosVigentes`, `snapshotDeModulos`.
3. `src/lib/billing/travas.ts` — `travarAssinatura`, `travarPlano`.
4. `src/lib/billing/gravar-status.ts` — `gravarStatusCalculado`.
5. `src/lib/services/billing.service.ts` e, se tocar troca de plano, `src/lib/services/plano.service.ts`.
6. `src/lib/plan/modules.ts` — catálogo de módulos e gate.

Sob demanda: `docs/05-planos-e-modulos.md` (fluxo de PIX, cartão, cron) e `docs/CONTEXTO-AGENTE.md` §8.

## Checagens

### Modelo de cobrança

- Não existe recorrência nem `preapproval` do Mercado Pago. Todo mês o cliente paga de novo em `/assinatura`. Não introduza assinatura recorrente sem decisão explícita.
- Valor cobrado sai **do plano no banco** (ou do `pendingPriceMonthly`/`monthlyAmount` da assinatura), nunca do corpo da requisição.
- Reajuste de catálogo não muda `monthlyAmount` de quem já assinou; só `AdminService.updateMonthlyAmount`.

### Status

- `computeStatus` é a fonte. Não recalcule status em outro lugar.
- `statusSource = MANUAL` (estorno, chargeback, admin) vence o cálculo e o cancelamento — `computeStatus` devolve `sub.status` direto.
- Trial: só começa na confirmação de e-mail (`emailVerifiedAt`, `signup.service.ts`). Sem `activatedAt`, só `trialEndsAt` libera; trial vencido é `SUSPENSO`, **nunca** `VENCIDO`.
- `graceDays` só vale para quem já pagou (`activatedAt` não nulo). `currentPeriodEnd` é ignorado enquanto `activatedAt` é nulo.
- Cancelado com período pago correndo → `ATIVO` até `currentPeriodEnd`, sem tolerância depois.
- Gravar status recalculado só por `gravarStatusCalculado` (condição em `updatedAt`): sem ela o recálculo grava `VENCIDO` por cima de um chargeback.
- Início do mês pago: `inicioDoPeriodoPago`. Avanço de mês: `addOneMonth` (nunca `setMonth`).

### Pagamento

- Confirmação **só pelo webhook** `src/app/api/webhooks/mercadopago/route.ts`: `verifyWebhookSignature` exige `MERCADOPAGO_WEBHOOK_SECRET` e recusa tudo sem ele, em qualquer ambiente. Depois, buscar o pagamento na API (`getPayment`); não confiar no body. Idempotente por `mpPaymentId`.
- Uma aprovação por competência: `SubscriptionPayment.approvedKey` (`<tenantId>:<referenceMonth>`, `@unique`, nula fora de `APROVADO`). Aprovado que não comprou mês grava `uncreditedAt`/`uncreditedReason`, nunca credita duas vezes.
- Aprovação decide pelo momento do pagamento (`paidAt`), não do processamento.
- Uma cobrança viva por empresa: gerar cobrança e aprovar pagamento baixam as pendentes de todas as competências e cancelam no MP (`cancelPayment`, best-effort, depois do commit).
- PIX fica **fora** do Payment Brick: `POST /api/billing/checkout`, QR na tela. Cartão pelo Brick em `POST /api/billing/checkout/card`; aceite `creditCard`/`credit_card` (camelCase e snake_case); 3DS `optional`.
- Cartão exige e-mail confirmado e tem teto no Postgres (`rateLimitDb`: 5/h por empresa, 10/h por IP) em `src/app/api/billing/checkout/card/route.ts`. Não remova.
- Competência a cobrar: `competenciaACobrar` (pagamento antecipado dentro da janela de lembrete). Fora dela, `MENSALIDADE_JA_PAGA` decidido pelo período pago.
- Aprovação, troca de plano e edição de plano travam as linhas (`travas.ts`) dentro da transação.

### Módulos e plano

- Quais módulos a empresa tem agora: **só** `featuresVigentes`. Não leia `plan.features` ao vivo para decidir acesso — seria a quarta leitura que o arquivo proíbe.
- `planModules` é fail-closed: plano sem `features.modules` não libera opcional nenhum.
- Troca com o mês já pago fica **agendada** (`pendingPlanId`, `pendingPlanFrom`, `pendingPriceMonthly`, `pendingFeatures`) e vira por `PlanoService.aplicarTrocaProgramada`. Depois de trocar, reemitir o token (`/api/auth/refresh`) para o claim `modules`.
- Gate de módulo é servidor: `src/proxy.ts` (`modulosDaRota` + `isModuleEnabled`, redirect `/plano?bloqueado=` ou 403) + `requireModule` nos wrappers (`module:` em `withTenantAction`/`withTenantRoute`) + `requirePagina({ modulo })` em `src/lib/auth/pagina.ts` nos `layout.tsx`. Esconder do menu é só UX.
- `/assinatura`, `/conta`, `/api/billing` e `/api/auth` ficam acessíveis bloqueado (`BILLING_SAFE_PREFIXES` em `src/proxy.ts`; rota de billing usa `allowInactive`).

### Cron

- Só dois crons: `src/app/api/cron/billing/route.ts` e `src/app/api/cron/avisos/route.ts`, protegidos por `CRON_SECRET`.
- O cron de billing reconcilia o MP com orçamento, recalcula status, manda lembrete e, como **sub-tarefas**, avança os checkpoints de custo (`EstoqueService.atualizarCheckpointsDeTodos`), importa cotações (`CotacoesImportService.importarTodasAsCentrais`), coleta CeasaNews (`NoticiasService`) e limpa fotos órfãs. Cada uma com `.catch` próprio e respeitando o orçamento. Tarefa periódica nova entra aqui; não crie cron novo.

### Tenant

- Billing e webhook usam `prisma` cru por desenho; `tenantId` entra explícito em cada consulta. Regras de `getTenantPrisma` estão na skill `implementar-ceasapro`.

## Testes do domínio

Unit:

- `tests/unit/billing-status.test.ts`, `billing-trial.test.ts`, `situacao-cobranca.test.ts`, `add-one-month.test.ts`
- `tests/unit/billing-checkout-contrato.test.ts`, `brick-method.test.ts`, `pix-charge.test.ts`, `pix-payload.test.ts`, `pix-pagador-cnpj.test.ts`
- `tests/unit/mp-webhook-signature.test.ts`, `mp-api-error.test.ts`, `webhook-mercadopago-route.test.ts`
- `tests/unit/cron-billing-orcamento.test.ts`, `cron-secret.test.ts`, `due-reminder-email.test.ts`
- `tests/unit/plan-modules.test.ts`, `actions-module-gate.test.ts`, `paginas-module-gate.test.ts`, `jwt-claims.test.ts`, `proxy-matcher.test.ts`

Integration:

- `billing-flow.test.ts`, `billing-cancel.test.ts`, `billing-cobranca-pendencias.test.ts`, `billing-due-reminder.test.ts`, `billing-plan-choice.test.ts`
- `mercadopago-webhook.test.ts`, `mercadopago-refund-chargeback.test.ts`, `pagamento-por-competencia.test.ts`, `pix-fluxo.test.ts`
- `plano-change.test.ts`, `plano-congelado.test.ts`, `plano-tolerancia-modulos.test.ts`, `plano-troca-agendada.test.ts`, `admin-planos-delete.test.ts`
- `signup-trial.test.ts`, `signup-alias-email.test.ts`

E2E: `tests/e2e/plano-assinatura.spec.ts`, `modulo-bloqueado.spec.ts`, `onboarding-trial.spec.ts`.

Comandos: `npm run test:unit`, `npm run test:integration`, `npx playwright test <arquivo>`, `npm run typecheck`.

## Windows

- No PowerShell não use `&&`; encadeie com `;`.
- `prisma generate` dá EPERM se `next dev` estiver aberto (lock do engine). Feche o dev server antes.
- `npm run test:integration` recusa `DATABASE_URL` remoto (`tests/setup/guard-database.ts`) e **apaga dados** das empresas de teste. Rode só contra Postgres local.
