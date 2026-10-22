---
name: boletim
description: Regras do módulo de Cotações do CEASA e do CeasaNews no CeasaPro — tabelas globais, raspadores, vínculo, alertas, feeds e filtro de notícias. Use ao mexer em cotação, boletim, preço do CEASA, CEAGESP, CEASAMINAS, praça, central, raspador, adaptador de fonte, importação de boletim, vínculo de produto, alerta de preço, CeasaNews, notícia, feed ou RSS.
---

# Boletim (Cotações e CeasaNews)

Os dois módulos leem dado público de terceiros e gravam em **tabelas globais**, sem `tenantId`. O erro caro aqui é tratar dado global como de empresa (ou o contrário) e aceitar leitura de fonte que quebrou em silêncio.

## Carregue a referência do assunto

- Cotações (fonte, importação, vínculo, alerta, série, embalagem): leia `.claude/skills/boletim/referencias/cotacoes.md`.
- CeasaNews (feed, parse, filtro, dedupe, tela): leia `.claude/skills/boletim/referencias/noticias.md`.

Leia só a do assunto. Mexeu nos dois, leia as duas.

## Comum aos dois

- Tabela global usa `prisma` cru e fica **fora** de `TENANT_MODELS`. Tabela com `tenantId` usa `getTenantPrisma` ou passa o `tenantId` da sessão explícito em cada consulta (regras de tenant: skill `implementar-ceasapro`).
- `parse` é puro e testado contra fixture real em `tests/fixtures/`. I/O fica fora dele.
- As coletas rodam como **sub-tarefas do cron de billing** (`src/app/api/cron/billing/route.ts`), cada uma com `.catch` próprio e orçamento de tempo. Não crie cron novo — ver skill `cobranca`, seção Cron.
- Gate: módulos `cotacoes` e `ceasanews`. Tela de núcleo que mostra boletim confere `isModuleEnabled(session.modules, "cotacoes")` no servidor.

## Testes

- Cotações, unit: `tests/unit/cotacoes-alerta.test.ts`, `cotacoes-ceagesp.test.ts`, `cotacoes-ceasaminas.test.ts`, `cotacoes-cron-e-rede.test.ts`, `cotacoes-csv.test.ts`, `cotacoes-embalagem.test.ts`, `cotacoes-frescor.test.ts`, `cotacoes-grafico.test.ts`, `cotacoes-nome.test.ts`, `cotacoes-variacao.test.ts`.
- Cotações, integration: `tests/integration/cotacoes-alertas.test.ts`, `cotacoes-envio.test.ts`, `cotacoes-historico.test.ts`, `cotacoes-import.test.ts`, `cotacoes-importador.test.ts`, `cotacoes-meus-produtos.test.ts`, `cotacoes-series.test.ts`, `cotacoes-vinculo.test.ts`, `cadastro-uf-central.test.ts`.
- CeasaNews: `tests/unit/noticias.test.ts`, `tests/integration/noticias.test.ts`.
- E2E: `tests/e2e/cotacoes.spec.ts`.
- Os testes bloqueiam rede e e-mail de saída (`tests/setup/no-outbound-http.ts`, `no-outbound-email.ts`): teste de fonte usa fixture, nunca a URL real.

Comandos: `npm run test:unit`, `npm run test:integration`, `npx playwright test tests/e2e/cotacoes.spec.ts`.

## Windows

- No PowerShell não use `&&`; encadeie com `;`.
- `prisma generate` dá EPERM se `next dev` estiver aberto (lock do engine). Feche o dev server antes.
- `npm run test:integration` recusa `DATABASE_URL` remoto (`tests/setup/guard-database.ts`) e **apaga dados** das empresas de teste. Rode só contra Postgres local.
