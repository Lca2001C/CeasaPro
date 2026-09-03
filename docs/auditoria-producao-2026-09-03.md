# Auditoria de produção — 2026-09-03

Caça a erros que um usuário real encontraria em produção, com correção mínima e
teste de regressão para cada achado.

Fora de escopo por combinação: o módulo **PDV em obras**
(`src/app/(app)/vendas/nova/**`, `vendas.service.ts`, `validations/venda.ts`,
migration `20260903180000_pdv_*`). Nada ali foi editado.

---

## Resumo

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| 1 | Baixar PDF respondia **500 sempre**, em produção | Alta — recurso morto | Corrigido |
| 2 | `atualizarHigienizacao` sem gate de módulo do plano | Baixa — furo de plano | Corrigido |
| 3 | Exportadores de relatório sem teste nenhum | — lacuna | Coberto |
| 4 | Varredura de layout 320px cobria 8 de 18 telas | — lacuna | Coberto |
| 5 | `npm audit`: 2 CVEs transitivos | Baixa | Adiado, com motivo |
| 6 | `EMAIL_FROM` em domínio gratuito | Média — entregabilidade | Adiado (config) |
| 7 | Dashboard "lento" | — | **Refutado por medição** |

Baseline e regressão final: `lint --max-warnings=0`, `typecheck`, unit,
integration, `build` e E2E — tudo verde. `preflight` falha só na checagem de
SMTP, por porta 465 bloqueada nesta rede (não é defeito do código).

---

## 1. Baixar PDF respondia 500 em produção · CORRIGIDO

**Sintoma.** `GET /api/reports/<tipo>/export?format=pdf` → 500. Em toda
tentativa, não só na segunda. O botão "Baixar PDF" da tela de relatórios estava
morto desde que existe. O Excel funcionava.

**Como foi confirmado.** Reconstruindo o app com o código anterior e baixando
pela rota real, no build de produção: `expect(200)` recebeu `500` na primeira
chamada. Não é teoria nem artefato do vitest.

**Causa.** O `module.exports` do `pdfmake` é uma **instância de classe**, e os
métodos dependem de `this` — `setFonts` faz `this.fonts = fonts`. O módulo
usava `import * as pdfMake from "pdfmake"` e chamava `pdfMake.setFonts(...)`,
o que amarra `this` ao *namespace* do módulo, que é imutável. Morria com
`TypeError: Cannot redefine property: fonts` na configuração de fonte, antes de
gerar qualquer byte.

**Correção.** Resolver a instância real antes de usar (`.default ?? namespace`),
que acerta nos dois interops. Uma linha; a geração do documento não foi tocada.

**Por que passava batido.** Nenhum teste chamava `toPdf` nem baixava relatório.
Um 500 fixo atravessava lint, typecheck, unit, integration, build e E2E.

---

## 2. `atualizarHigienizacao` sem gate de módulo · CORRIGIDO

Era a única das seis actions de higienização sem `module: "higienizacao"`.

**Por que o gate de rota não cobria.** O bloqueio por módulo do `proxy.ts` olha
o *pathname*, e o id de uma Server Action é global: ela pode ser invocada por
POST a partir de qualquer URL. Uma empresa que perdeu o módulo num downgrade
continuaria editando lote de higienização, porque a requisição não passa por
`/higienizacao/*`.

**Alcance.** O isolamento por tenant seguia valendo — não havia acesso a dado de
outra empresa. O furo é de plano, não de vazamento.

**Regressão.** `tests/unit/actions-module-gate.test.ts` lê o fonte dos três
arquivos de actions de módulo opcional e exige `module:` em cada
`withTenantAction`, além de afirmar que o wrapper realmente chama
`requireModule`. Lê o fonte porque as actions são `"use server"` e não expõem as
opções em runtime. Verificado removendo a linha: o teste falha nomeando a action.

---

## 3–4. Lacunas de cobertura fechadas

**Exportadores de relatório.** Só `spreadsheetSafe` era testado, isolado da
geração. Agora: 8 casos unitários sobre os **bytes** (assinatura de arquivo,
xlsx reaberto com título/cabeçalho/totais, fórmula neutralizada chegando ao
arquivo, relatório vazio) e 6 E2E baixando Excel e PDF pela rota real no build
de produção — o PDF **duas vezes**, porque a configuração de fonte é preguiçosa
e guardada no módulo: numa instância serverless aquecida seria a segunda
chamada a quebrar.

**Layout 320px.** A varredura media vazamento em oito telas (as que têm cartão
de número). Mais dez entraram: histórico de vendas, produtos, compras,
fornecedores, relatórios, categorias de despesa, nova despesa, novo fiado,
configurações, como usar. **Nenhum defeito novo** — o que faltava era a rede.
O bloco novo não exige que a tela tenha cartão (várias abrem vazias), então mede
estouro horizontal sempre e vazamento só quando há cartão.

---

## 5. Dependências · ADIADO com motivo

`npm audit`: 5 vulnerabilidades, 2 avisos-raiz, **ambos transitivos e sem
correção não-destrutiva**.

| Pacote | Grav. | Caminho | Decisão |
|---|---|---|---|
| `deepmerge-ts` <8.0.0 | alta | `prisma` → `@prisma/config` | Aguardar upstream |
| `uuid` <11.1.1 | moderada | `exceljs` | Não forçar |

- **`deepmerge-ts`**: exaustão de pilha ao mesclar grafos recursivos. Só é
  alcançado pelo **CLI** do Prisma lendo arquivo de configuração
  (`prisma generate`, `scripts/deploy-migrate.mjs`) — não pelo tratamento de
  requisição. `npm audit` reporta `fixAvailable: undefined`: não há versão
  corrigida na cadeia. Observação secundária: `prisma` está em `dependencies`
  e não em `devDependencies`, o que engorda o bundle sem necessidade — mexer
  nisso é mudança de build, fora do escopo desta auditoria.
- **`uuid`**: falta de checagem de limites quando o chamador passa `buf` para
  v3/v5/v6. Nós apenas **escrevemos** `.xlsx` e nunca passamos `buf`.
  `npm audit fix --force` propõe `exceljs@3.4.0` — **downgrade que quebra a API
  usada** no exportador. Os testes novos dos exportadores são a rede que pega
  essa tentativa, se alguém rodar o `--force`.

---

## 6. Entregabilidade de e-mail · ADIADO (configuração)

O próprio `preflight` avisa: `EMAIL_FROM` sai de domínio gratuito
(`gmail.com`). E-mail transacional com nome de marca partindo de conta gratuita
é fortemente penalizado por filtro — é a causa mais provável de "não recebi o
e-mail de redefinição de senha". Correção é de infraestrutura: domínio próprio
com SPF, DKIM e DMARC publicados. Não é código.

Na rede desta máquina o `preflight` também falha ao abrir `smtp.gmail.com:465`
(porta bloqueada). Onde a porta estiver liberada, essa checagem passa.

---

## 7. Otimização · NADA APLICADO, POR MEDIÇÃO

O plano sugeria índices e revisão de N+1. **Medi antes**, com volume de ~2 anos
de operação (5.000 vendas, 8.000 despesas, 1.500 fiados, 2.000 movimentos de
caixa):

| Consulta | Tempo |
|---|---|
| `DashboardService.getSummary` | **9,8 ms** |
| `DespesasService.resumoMes` | 5,6 ms |
| `DespesasService.list` (vencidas) | 5,2 ms |
| `VendasService.list` (hoje) | 1,9 ms |
| `VendasService.ultimosPrecos` | 5,9 ms |
| `FiadoService.listOpen` | 24,5 ms |
| `buildReport DESPESAS` (12 meses) | 91,3 ms |
| `buildReport VENDAS` (12 meses) | 72,6 ms |

`EXPLAIN (ANALYZE)` da consulta de despesas vencidas: *Index Scan* em
`expenses_tenantId_dueDate_idx`, **0,18 ms** de execução. O índice composto
`(tenantId, status, dueDate)` que o plano propunha seria peso morto — **não foi
criado**. Idem para os outros dois: `sales` já tem
`(tenantId, saleDate)`/`(tenantId, cancelledAt)` e `credit_accounts` já tem
`(tenantId, status)`.

**Ressalva que vale registrar.** Medido **imediatamente após** inserir as 16 mil
linhas, o `getSummary` levou **5,9 s** — o planner do Postgres estava sem
estatísticas e escolhia planos ruins. Passou a 9,8 ms depois do `ANALYZE`
(automático). Em produção o autovacuum mantém isso em dia, mas o caminho de
**importação/carga em massa** deve terminar com `ANALYZE`, senão a primeira
visita ao painel depois da carga é de vários segundos.

Nada de Redis, nada de cache, nada de refactor — como combinado.

---

## Verificações de segurança

| Verificação | Resultado |
|---|---|
| `tests/integration/tenant-isolation.test.ts` | Passa |
| `tests/integration/rate-limit-db.test.ts` | Passa |
| `tests/unit/mp-webhook-signature.test.ts` | Passa |
| Rotas `/api/*` sem `withTenantRoute`/`withAdminRoute` | 12, **todas legítimas**: `auth/*` (públicas por natureza), `cron/*` (protegidas por `CRON_SECRET`), `webhooks/mercadopago` (assinatura HMAC), `health` |
| SQL cru sem filtro de `tenantId` | Nenhum. A única exceção é `rate-limit-db`, que é de plataforma e chaveada por hash |
| `tenantId` vindo de input do cliente | Só em `validations/admin.ts`, sob `withAdminAction` (super-admin agindo sobre uma empresa) — correto |
| Stack trace vazando para o cliente | Não. `error-response.ts` e `action-result.ts` devolvem código opaco + `ref` e registram o detalhe no log |
| Gate de módulo em Server Action | 1 furo achado e corrigido (item 2); agora coberto por teste |

---

## Riscos residuais

1. **PDV fora de escopo.** Não foi auditado. Quando o módulo estabilizar, vale
   repetir sobre ele o que foi feito aqui — em especial cobrir por E2E os
   caminhos de pagamento misto, desconto e cancelamento.
2. **CVEs transitivos** (item 5) continuam abertos, com o raciocínio de
   exposição registrado. Reavaliar quando `@prisma/config` e `exceljs`
   publicarem versões corrigidas.
3. **Entregabilidade de e-mail** (item 6) depende de mudança de DNS/domínio.
4. **Sem `ANALYZE` após carga em massa** (item 7), a primeira abertura do painel
   fica lenta. Só afeta importação, não a operação normal.

## Checklist de deploy

Nada nesta auditoria exige variável de ambiente nova. Duas observações que já
valiam antes e continuam valendo:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` é substituída em tempo de **build**: mudá-la na
  Vercel exige **rebuild**, não só redeploy. Sem ela, o opt-in de avisos se
  anuncia como indisponível.
- `EMAIL_FROM` em domínio próprio (item 6) para o e-mail transacional sair do
  spam.
