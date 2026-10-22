---
name: dinheiro-e-estoque
description: Regras de dinheiro, estoque e desfazer do CeasaPro — onde mora cada fórmula, como o livro-razão funciona e o que não pode quebrar. Use ao mexer em venda, PDV, compra, estoque, fiado, despesa, lucro, margem, CMV, custo médio, desfazer, estorno, cancelamento de lançamento, embalagem, caixa plástica ou higienização, inclusive em relatório ou painel que some esses valores.
---

# Dinheiro e estoque

Esta skill é a dona das invariantes de dinheiro, livro-razão e desfazer. As outras skills remetem para cá.

## Antes de editar

Abra e leia, nesta ordem:

1. `src/lib/services/financial-calc.service.ts` — objeto `FinancialCalc`, fonte única das fórmulas (o cabeçalho lista todas).
2. `src/lib/desfazer/prazo.ts` — `HORAS_PARA_DESFAZER`, `podeDesfazer`, `dentroDoPrazoDeDesfazer`, `foraDoPrazoDeDesfazer`.
3. `src/lib/estoque/origens.ts` — constantes de `stock_movements.sourceType`.
4. O service do domínio em `src/lib/services/`: `vendas.service.ts`, `compras.service.ts`, `estoque.service.ts`, `fiado.service.ts`, `despesas.service.ts`, `embalagens.service.ts`, `higienizacao.service.ts`.

Contexto do produto: `docs/CONTEXTO-AGENTE.md` §3 (regras 2, 3, 4, 5, 13), §9 e §13b. Não repita aqui o que está lá; volte ao arquivo.

## Checagens

### Fórmula

- Calcule total, lucro, margem, CMV, faturamento, rateio de frete, custo médio de embalagem e saldo de fiado **só** por `FinancialCalc` (`valorTotalCompra`, `custoRealUnitario`, `ratearFrete`, `valorTotalVenda`, `receitaLiquidaPorLinha`, `faturamento`, `lucroBruto`, `custoDoVendido`, `custoMedioMovel`, `custoVendaEmbalagem`, `lucroLiquido`, `margemLiquida`, `saldoFiado`, `totaisDespesas`, `valorTotalEstoque`). Fórmula nova entra nesse objeto, como função pura, com teste em `tests/unit/financial-calc.test.ts`.
- Não escreva `a * b`, `reduce((s, x) => s + x)` ou `Number(...)` sobre dinheiro em service, rota ou tela.

### Tipo

- Dinheiro e quantidade são `Prisma.Decimal`. Use os helpers de `src/lib/money.ts` (`toDecimal`, `add`, `sub`, `mul`, `div`, `sum`, `money`). Nunca `number`/`Float` no schema nem no cálculo.
- Quantidade: 3 casas. Dinheiro: 2. Custo de ajuste: 4. Limites e tetos em `src/lib/validations/quantidade.ts`.
- Componente `"use client"` **não importa** `@/lib/money` (arrasta o runtime do Prisma para o navegador). No cliente use `@/lib/numero` e `@/lib/format`.

### Livro-razão

- Estoque e caixas plásticas não têm coluna de saldo. Saldo = soma de `stock_movements` / `plastic_crate_movements`. Não crie coluna de saldo, nem cache gravado que vire fonte.
- Movimento é só acrescentado. Não faça `update` nem `delete` em linha de livro-razão para "corrigir".
- Quantidade sem custo: `EstoqueService.getQuantidades`. Custo: `sqlCustoEstoque` (média ponderada móvel, repassada em ordem de `createdAt`).

### Origem do movimento

- Todo `sourceType` novo vira constante em `src/lib/estoque/origens.ts`. `sqlCustoEstoque` reconhece origens **pelo texto** (o par compra/estorno e o par ajuste/desfeito saem juntos do repasse); um literal digitado fora desse arquivo faz o preço errado voltar à média sem erro nenhum.
- Use as constantes que existem: `ORIGEM_COMPRA`, `ORIGEM_COMPRA_CANCELADA`, `ORIGEM_VENDA`, `ORIGEM_VENDA_CANCELADA`, `ORIGEM_AJUSTE`, `ORIGEM_AJUSTE_DESFEITO`, `ORIGEM_PRODUTO_EXCLUIDO`, `ORIGEM_BAIXA_EMBALAGEM`.

### Desfazer

- Uma regra só: `dentroDoPrazoDeDesfazer(registro.createdAt)` e `podeDesfazer(session.role)`. O prazo conta do `createdAt`, **nunca** da data digitada (`saleDate`, `purchaseDate`, `paidAt`). Mensagem de recusa: `foraDoPrazoDeDesfazer(acao)`.
- Desfazer **marca** o lançamento (`cancelledAt` em venda, compra e venda de embalagem; `reversedAt` em recebimento de fiado) e lança **movimento de estorno**. Não apague a linha nem o movimento original.
- Venda cancelada devolve estoque com `AJUSTE` `SALE_CANCELLED` pelo `unitCostAtSale` (o custo com que saiu), não pela média da hora.
- Cancelar venda — à vista, fiada ou mista — só por `VendasService.cancelarVenda`. O fiado passa por ele (`FiadoService.cancelarVendaDoFiado` delega). Não volte a apagar fiado.
- Compra só se cancela sem saída nem ajuste posterior nos produtos dela (`ComprasService.cancelarCompra`).
- Operação que toca 2+ tabelas roda em `prisma.$transaction`, com `audit()` **dentro** da transação.

### Despesa

- `Expense.origem` decide o lado: `MANUAL` entra no lucro, em Fixas/Variáveis e no "% do faturamento". `COMPRA`, `FRETE_COMPRA` e `COMPRA_EMBALAGEM` (`ORIGENS_DE_COMPRA` em `despesas.service.ts`) ficam **fora** do lucro — o custo já está no CMV — e **dentro** de contas a pagar, vencidas, avisos, contas pagas e fluxo de caixa.
- Soma nova que mede custo operacional filtra `SO_OPERACIONAIS` (`origem: "MANUAL"`). Soma nova que mede dinheiro devido ou pago inclui tudo. Errar o lado conta a mercadoria duas vezes ou some com a dívida do fornecedor.

### Filtro de cancelado

- Toda soma, "última compra" ou "último preço" sobre `purchases`, `sales` ou `packaging_sales` filtra `cancelledAt IS NULL` (Prisma: `cancelledAt: null`) além de `deletedAt`. Recebimento de fiado filtra `reversedAt IS NULL`.

### Checkpoint do custo médio

- `stock_cost_checkpoints` é derivada. Mudou a regra do custo médio (`sqlCustoEstoque`, ordem do repasse, origens que saem em par)? Rode `npx tsx scripts/recalcular-checkpoints.ts` depois do deploy, senão o número velho fica embutido.
- O corte é `IDADE_MINIMA_CHECKPOINT_MS` (7 dias, em `estoque.service.ts`) e supõe que todo estorno sai dentro de `HORAS_PARA_DESFAZER`. Não aumente o prazo de desfazer além do corte, e não corrija movimento antigo à mão sem recalcular os checkpoints da empresa.
- O índice `stock_movements (tenantId, productId, createdAt, id)` é a ordem da janela do custo. Não reordene um sem o outro.

### Data e idempotência

- Data de lançamento passa por `dataNaoAntesDoMesPassado` (`src/lib/validations/venda.ts`); despesa fica fora.
- Fuso só por `src/lib/tz.ts` (`parseFormDateTz`, `startOfMonthTz`…).
- Lançamento transacional novo ganha `idempotencyKey` com `comIdempotencia` (`src/lib/http/idempotencia.ts`); no formulário, `chavePorConteudo` (`src/lib/idempotencia-cliente.ts`).

### Tenant

- Módulo de negócio usa `getTenantPrisma(tenantId)`, com `tenantId` da sessão. A mecânica está na skill `implementar-ceasapro`.

## Testes do domínio

Unit (sem banco):

- `tests/unit/financial-calc.test.ts`, `venda-total.test.ts`, `venda-pdv.test.ts`, `pdv-regras.test.ts`, `receita-liquida-periodo.test.ts`
- `tests/unit/estoque-nivel.test.ts`, `custo-carga.test.ts`, `crate-balance.test.ts`, `embalagem-limites.test.ts`, `fiado-resumo.test.ts`, `fiado-caixas-gate.test.ts`
- `tests/unit/contas-unificadas.test.ts`, `despesas-filtros.test.ts`, `despesas-filtros-url.test.ts`, `despesas-url-e-replicacao.test.ts`, `varredura-21-10.test.ts`

Integration (Postgres local):

- Venda e PDV: `vendas-flow.test.ts`, `venda-pdv-fluxo.test.ts`, `retirada-e-clientes.test.ts`
- Desfazer: `desfazer-lancamentos.test.ts`
- Compra: `compra-despesa.test.ts`, `compra-despesa-backfill.test.ts`, `compra-idempotencia.test.ts`, `compra-caixas.test.ts`
- Estoque e custo: `estoque-checkpoint.test.ts`, `estoque-custo-ajuste.test.ts`, `produto-cadastro-estoque.test.ts`, `produto-unidade-venda.test.ts`
- Fiado e despesas: `fiado-crud.test.ts`, `despesas-fluxo.test.ts`, `despesas-paginacao.test.ts`
- Fase 2: `fase2-flow.test.ts`, `embalagens-estoque.test.ts`, `higienizacao-ciclo.test.ts`, `higienizacao-vinculo-corrida.test.ts`
- Painel e relatórios: `painel-financeiro.test.ts`, `relatorios-painel-correcoes.test.ts`, `relatorios-desconto-posicao.test.ts`
- Varreduras: `auditoria-2026-10-21.test.ts`, `varredura-2026-10-21.test.ts`

E2E: `tests/e2e/pdv.spec.ts`, `pdv-fiado.spec.ts`, `compras.spec.ts`, `estoque.spec.ts`, `fiado.spec.ts`, `despesas.spec.ts`, `embalagens.spec.ts`, `caixas.spec.ts`, `higienizacao.spec.ts`.

Comandos: `npm run test:unit`, `npm run test:integration`, `npx playwright test <arquivo>`, `npm run typecheck`.

## Windows

- No PowerShell não use `&&`; encadeie com `;`.
- `prisma generate` dá EPERM se `next dev` estiver aberto (lock do engine). Feche o dev server antes.
- `npm run test:integration` recusa `DATABASE_URL` remoto (`tests/setup/guard-database.ts`) e **apaga dados** das empresas de teste. Rode só contra Postgres local.
