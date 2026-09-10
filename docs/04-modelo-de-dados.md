# 4. Modelo de dados

Banco **PostgreSQL** modelado com **Prisma**. O schema-fonte é [`prisma/schema.prisma`](../prisma/schema.prisma). Os nomes de tabela no banco são em `snake_case` (via `@@map`).

## Convenções gerais

- **IDs**: `cuid()` (string).
- **Dinheiro**: `Decimal(14,2)`; **quantidades**: `Decimal(14,3)`; preço de custo `Decimal(14,4)`. Nunca `Float`.
- **Colunas de tempo**: `createdAt`, `updatedAt`; e `deletedAt` (soft delete) nas tabelas de cadastro/documento.
- **Multi-tenant**: tabelas operacionais têm `tenantId`. O filtro por tenant é injetado automaticamente (ver [Arquitetura](02-arquitetura.md)).
- **Ledgers append-only** (não têm soft delete): `stock_movements`, `credit_payments`, `plastic_crate_movements`, `subscription_payments`, `audit_logs`. Correções são feitas por novos lançamentos, não por edição.

## Enums

| Enum | Valores |
|---|---|
| `UserRole` | SUPER_ADMIN, OWNER |
| `SaleUnit` | CAIXA, KG, SACO, BANDEJA, UNIDADE |
| `RecipientType` | PLASTICA, PAPELAO, MADEIRA |
| `PaymentMethod` | PIX, DINHEIRO, CARTAO, FIADO |
| `CreditStatus` | EM_ABERTO, PAGO |
| `StockMovementType` | ENTRADA, SAIDA, QUEBRA, DOACAO, AJUSTE |
| `ExpenseType` | FIXA, VARIAVEL |
| `ExpenseStatus` | PENDENTE, PAGO |
| `TenantStatus` | ACTIVE, SUSPENDED, BLOCKED |
| `SubscriptionStatus` | ATIVO, VENCIDO, SUSPENSO, BLOQUEADO, CANCELADO |
| `StatusSource` | AUTO, MANUAL |
| `PaymentStatus` | PENDENTE, APROVADO, RECUSADO, ESTORNADO, CANCELADO |
| `PlasticCrateMovementType` | ENTRADA, SAIDA, RETORNO, QUEBRA |
| `CrateCleaningStatus` | ENVIADO, DEVOLVIDO, PAGO |
| `ReportType` | VENDAS, COMPRAS, ESTOQUE, FIADO, INADIMPLENTES, FORNECEDORES, DESPESAS, FLUXO_CAIXA, LUCRO_PRODUTO, MAIS_VENDIDOS, CAIXAS_PLASTICAS, HIGIENIZACAO, EMBALAGENS |
| `ReportFormat` | PDF, EXCEL |
| `ReportStatus` | PENDENTE, PROCESSANDO, CONCLUIDO, ERRO |
| `CeasaSerie` | CENTRAL, NACIONAL |
| `CeasaImportStatus` | OK, VAZIO, FALHA |
| `BoletimEnviadoStatus` | PENDENTE, PUBLICADO, RECUSADO |

Enum novo precisa de mapa em [`src/lib/labels.ts`](../src/lib/labels.ts) **ou** de dispensa justificada — `tests/unit/labels-cobertura.test.ts` compara esta tabela com o schema e reprova quem esquecer. Sem rótulo a tela renderiza vazio, sem erro e sem log.

## Plataforma / SaaS

### `tenants` (empresa)
Dados da empresa assinante. **Não** tem `tenantId` (é a própria empresa). Campos: `tradeName` (nome fantasia), `legalName`, `cnpj` (único), `phone`, `address`, `logoUrl`, `businessHours`, `status` (`TenantStatus`, default ACTIVE), `onboardingCompletedAt`. Relações: `users`, `subscription` (1‑1), e todos os dados operacionais.

### `plans` (plano comercial)
`name`, `slug` (único), `priceMonthly` `Decimal(10,2)`, **`features` (Json)** — guarda os módulos incluídos no formato `{ "modules": ["caixas", ...] }` —, `active`.

### `users`
`tenantId` (**nulo** só para o SUPER_ADMIN), `name`, `email`, `passwordHash` (Argon2id), `role`, `active`, `mustChangePassword`, `lastLoginAt`, `resetTokenHash`, `resetTokenExpiresAt`. Único por `(tenantId, email)`.

### `refresh_tokens`
Sessões: `userId`, `tokenHash` (único — guarda-se o hash, nunca o token), `expiresAt`, `revokedAt`, `userAgent`, `ip`.

### `tenant_subscriptions` (assinatura — 1 por empresa)
`planId`, `status` (`SubscriptionStatus`), `statusSource` (AUTO/MANUAL — override do super-admin), `statusReason`, `monthlyAmount`, `startedAt`, `activatedAt` (data do 1º pagamento aprovado; nulo = nunca pagou, sem acesso), `currentPeriodEnd`, `graceDays` (tolerância pós-vencimento, só vale após a 1ª ativação), `mpCustomerId`, `cancelledAt`.

### `subscription_payments` (cobranças de mensalidade — append-only)
`subscriptionId`, `tenantId`, `amount`, `status` (`PaymentStatus`), `method`, `referenceMonth` ("2026-07"), `mpPaymentId` (único — idempotência do webhook), `mpPreferenceId`, `mpExternalRef`, `qrCode`, `qrCodeBase64`, `ticketUrl`, `paidAt`, `periodStart/End`, `rawPayload` (Json de auditoria).

## Operacionais (por empresa)

### `products`
`name`, `saleUnit`, `qtyPerRecipient`, `recipientType`, `sackCapacity`, `active`. Estoque **não** é coluna — é derivado dos movimentos.

### `suppliers`
`name`, `phone`, `address`, `notes`, `active`.

### `purchases` + `purchase_items`
Compra (cabeçalho): `supplierId?`, `purchaseDate`, `freight`, `totalAmount`, `notes`. Item: `productId`, `quantity`, `unitPrice`, `recipientType?`, `freightShare` (frete rateado), `unitCost` (`Decimal(14,4)`, custo real com frete), `lineTotal`, `suggestedSalePrice?`.

### `sales` + `sale_items`
Venda: `customerName?`, `saleDate`, `paymentMethod`, `totalAmount`. Item: `productId`, `quantity`, `unitPrice`, `recipientType?`, `lineTotal`, `unitCostAtSale` (custo congelado no momento da venda, base do lucro).

### `credit_accounts` + `credit_payments` (fiado)
Conta: `saleId?` (1‑1 com a venda fiada), `customerName`, `customerPhone?`, `totalAmount`, `paidAmount` (cache mantido na transação), `status`, `dueDate?`. Pagamento (append-only): `accountId`, `amount`, `method`, `paidAt`. **Saldo = total − pago**.

### `stock_movements` (ledger de estoque — append-only)
`productId`, `type` (`StockMovementType`), `quantity` (sempre positivo; o sinal vem do tipo), `unitCost?`, `reason?`, `sourceType` ("PURCHASE"/"SALE"/"MANUAL"), `sourceId?`, `movedAt`. O saldo e o valor em estoque são somas deste ledger.

### `expenses` + `expense_categories`
Despesa: `categoryId?`, `description`, `amount`, `dueDate?`, `paidDate?`, `type` (fixa/variável), `status` (pendente/pago). Categoria: `name`, `isDefault` (única por `(tenantId, name)`).

### `report_exports`
Histórico de exportações: `userId?`, `type`, `format`, `status`, `periodStart/End`, `filters` (Json), `rowCount`, `fileName`, `errorMessage`. Guarda só metadados.

## Fase 2

### `plastic_crate_movements` (ledger de caixas plásticas — append-only)
`type` (`PlasticCrateMovementType`), `quantity` (Int), `brokenQty` (quebradas na chegada), `customerName?`, `supplierName?`, `movementDate`, `notes?`. Saldos derivados (ver [Funcionalidades](03-funcionalidades.md#caixas-plásticas)).

### `crate_cleanings` (higienização)
`cleanerName`, `sentDate`, `sentQty`, `unitPrice`, `totalAmount`, `returnedQty`, `returnedDate?`, `paidAmount`, `paidDate?`, `status` (`CrateCleaningStatus`), `notes?`.

### `packaging_types` + `packaging_sales`
Tipo: `name`, `active` (único por `(tenantId, name)`). Venda: `packagingTypeId`, `customerName?`, `saleDate`, `quantity` (Int), `unitPrice`, `totalAmount`.

## Cotações do CEASA (módulo `cotacoes`)

**As quatro primeiras tabelas NÃO têm `tenantId`, e é decisão.** O preço que a praça publica é o mesmo para todo mundo que compra ali; copiá-lo por empresa multiplicaria a importação pelo número de clientes sem nenhum ganho. Seguem o molde de `rate_limits`: sem relação com `Tenant`, acesso pelo `prisma` cru, e por construção fora de `TENANT_MODELS`.

### `ceasa_centrals`
Entreposto. `code` (**PK textual**, ex. `CEAMG`, `SPCEA` — o importador referencia a praça por código, não por id gerado), `name`, `city`, `uf`, `sourceKey` (qual adaptador busca; `manual` = ninguém busca), `sourceParams?` (Json, parâmetros da fonte), `active`, `maxDiasSemBoletim` (a partir de quantos dias o boletim é "velho" — o **mesmo** número que a tela do cliente e o alarme de defasagem usam, para os dois nunca discordarem), `sortOrder`.

### `ceasa_products`
Catálogo do boletim, **global e não por praça** — assim o vínculo da empresa sobrevive à troca de central quando o nome coincide. `name`, `serie` (`CeasaSerie`), `slug`, `firstSeenAt`, `lastSeenAt`, `active`. Único por `(serie, slug)`: dentro da série, não global.

### `ceasa_quotes`
A cotação. **Chave primária composta natural, sem `id`:** `(centralCode, quoteDate, ceasaProductId, unit)`. O `id` de cuid era 23% do tamanho da tabela e nunca era lido (medido com 205 mil linhas). `quoteDate` é `@db.Date`; `unit` é `NOT NULL DEFAULT ''` porque vários NULL não colidem em índice único no Postgres, e a reimportação do mesmo dia duplicaria linha; `refPrice` **não** é anulável; `minPrice`/`avgPrice`/`maxPrice` são.

### `ceasa_import_runs`
Uma linha por tentativa de importação: `status` (`CeasaImportStatus`), `rowsParsed`, `rowsUpserted`, `durationMs`, `httpStatus?`, `error?`, `fingerprint?` (assinatura **estrutural** da resposta — quais campos vieram, nunca hash do corpo).

### `tenant_ceasa_links` (tem `tenantId`)
Produto da empresa ↔ produto do boletim, **mais a embalagem**. Único por `(tenantId, productId)` — um item do boletim por produto seu, e **não** o inverso ("Tomate caixa" e "Tomate kg" podem apontar para o mesmo item). `unit` é **anulável**, e os três valores são distintos: `NULL` = o cliente não escolheu (vale para todas as embalagens), `''` = o boletim não informou embalagem, `'KG'` = ele escolheu o quilo.

### `tenant_ceasa_alertas` (tem `tenantId`)
"Me avise se mexer". Único por `(tenantId, ceasaProductId, unit)` — a unidade entra na chave porque um teto de R$ 5,00 é barato para a caixa e caro para o quilo. `variacaoMinima` (`Decimal(5,2)`, por alerta e não fixo no código: cebola oscila muito mais que batata), `precoTeto?`, `precoPiso?`.

### `tenant_boletins_enviados` (tem `tenantId`)
Boletim que o **cliente** enviou, aguardando o super-admin publicar. `centralCode`, `quoteDate` (`@db.Date`), `textoCru` (o que foi colado, não as linhas parseadas), `linhasValidas`, `linhasIgnoradas`, `status` (`BoletimEnviadoStatus`), `motivo?` (da recusa — o cliente lê), `revisadoPor?`, `revisadoEm?`. É rascunho com escopo de empresa de propósito: gravação direta em `ceasa_quotes` (tabela global, e a gravação sobrescreve) faria um cliente mexer no preço que os concorrentes dele leem, sem caminho de volta.

## Auditoria

### `audit_logs`
Trilha imutável, **sem relação/cascade** (sobrevive ao soft delete da empresa). `tenantId?`, `userId?`, `actorEmail?`, `action` ("CREATE"/"UPDATE"/"DELETE"/"PAYMENT"/"LOGIN"/"STATUS_CHANGE"/"PASSWORD_RESET_REQUESTED"/"PASSWORD_RESET"), `entity`, `entityId?`, `oldData?` (Json), `newData?` (Json), `ip?`, `createdAt`.

## Infraestrutura

### `rate_limits`
Contador das rotas de autenticação, **sem relação com nenhuma outra tabela**. `keyHash` (PK — SHA-256 de `"login:<ip>:<email>"`, nunca o texto puro, porque a chave é dado pessoal), `count`, `expiresAt`. Fica no banco, e não em memória, porque em serverless cada request pode cair numa instância diferente. As janelas vencidas são inertes e removidas pelo cron diário de billing. Detalhes em [06 — Segurança](06-seguranca.md).

## Regras de exclusão (onDelete)

- **Cascade**: empresa → todos os filhos; cabeçalho (compra/venda) → itens; conta de fiado → pagamentos.
- **Restrict**: `product` referenciado por itens/movimentos não é apagado (usa-se soft delete); `plan` em uso por assinatura.
- **SetNull**: `supplier` ↔ `purchase`; `category` ↔ `expense` (preserva o documento se o cadastro sair).

## Índices

Índices compostos liderados por `tenantId` para isolamento + performance: por data (`purchaseDate`, `saleDate`, `movedAt`, `paidAt`…), por status, por nome (busca) e chaves de idempotência/unicidade (`subscription_payments.mpPaymentId`, `users (tenantId,email)`, `expense_categories (tenantId,name)`, `packaging_types (tenantId,name)`).

## Migrations

Em [`prisma/migrations/`](../prisma/migrations/). Duas migrations: `..._init` (Fase 1 + plataforma/billing + auditoria) e `..._fase2_caixas_higienizacao_embalagens` (Fase 2 + novos tipos de relatório). Em produção use `prisma migrate deploy` (ver [Instalação e deploy](07-instalacao-e-deploy.md)).
