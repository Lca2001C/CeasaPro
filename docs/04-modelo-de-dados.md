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
| `SubscriptionStatus` | TRIAL, ATIVO, VENCIDO, SUSPENSO, BLOQUEADO, CANCELADO |
| `StatusSource` | AUTO, MANUAL |
| `PaymentStatus` | PENDENTE, APROVADO, RECUSADO, ESTORNADO, CANCELADO |
| `PlasticCrateMovementType` | ENTRADA, SAIDA, RETORNO, QUEBRA |
| `CrateCleaningStatus` | ENVIADO, DEVOLVIDO, PAGO |
| `ReportType` | VENDAS, COMPRAS, ESTOQUE, FIADO, INADIMPLENTES, FORNECEDORES, DESPESAS, FLUXO_CAIXA, LUCRO_PRODUTO, MAIS_VENDIDOS, CAIXAS_PLASTICAS, HIGIENIZACAO, EMBALAGENS |
| `ReportFormat` | PDF, EXCEL |
| `ReportStatus` | PENDENTE, PROCESSANDO, CONCLUIDO, ERRO |

## Plataforma / SaaS

### `tenants` (empresa)
Dados da empresa assinante. **Não** tem `tenantId` (é a própria empresa). Campos: `tradeName` (nome fantasia), `legalName`, `cnpj` (único), `phone`, `address`, `logoUrl`, `businessHours`, `status` (`TenantStatus`, default ACTIVE), `onboardingCompletedAt`. Relações: `users`, `subscription` (1‑1), e todos os dados operacionais.

### `plans` (plano comercial)
`name`, `slug` (único), `priceMonthly` `Decimal(10,2)`, `maxUsers` (opcional), **`features` (Json)** — guarda os módulos incluídos no formato `{ "modules": ["caixas", ...] }` —, `active`.

### `users`
`tenantId` (**nulo** só para o SUPER_ADMIN), `name`, `email`, `passwordHash` (Argon2id), `role`, `active`, `mustChangePassword`, `lastLoginAt`, `resetTokenHash`, `resetTokenExpiresAt`. Único por `(tenantId, email)`.

### `refresh_tokens`
Sessões: `userId`, `tokenHash` (único — guarda-se o hash, nunca o token), `expiresAt`, `revokedAt`, `userAgent`, `ip`.

### `tenant_subscriptions` (assinatura — 1 por empresa)
`planId`, `status` (`SubscriptionStatus`), `statusSource` (AUTO/MANUAL — override do super-admin), `statusReason`, `monthlyAmount`, `startedAt`, `trialEndsAt`, `currentPeriodEnd`, `graceDays` (tolerância), `mpCustomerId`, `cancelledAt`.

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

## Auditoria

### `audit_logs`
Trilha imutável, **sem relação/cascade** (sobrevive ao soft delete da empresa). `tenantId?`, `userId?`, `actorEmail?`, `action` ("CREATE"/"UPDATE"/"DELETE"/"PAYMENT"/"LOGIN"/"STATUS_CHANGE"), `entity`, `entityId?`, `oldData?` (Json), `newData?` (Json), `ip?`, `createdAt`.

## Regras de exclusão (onDelete)

- **Cascade**: empresa → todos os filhos; cabeçalho (compra/venda) → itens; conta de fiado → pagamentos.
- **Restrict**: `product` referenciado por itens/movimentos não é apagado (usa-se soft delete); `plan` em uso por assinatura.
- **SetNull**: `supplier` ↔ `purchase`; `category` ↔ `expense` (preserva o documento se o cadastro sair).

## Índices

Índices compostos liderados por `tenantId` para isolamento + performance: por data (`purchaseDate`, `saleDate`, `movedAt`, `paidAt`…), por status, por nome (busca) e chaves de idempotência/unicidade (`subscription_payments.mpPaymentId`, `users (tenantId,email)`, `expense_categories (tenantId,name)`, `packaging_types (tenantId,name)`).

## Migrations

Em [`prisma/migrations/`](../prisma/migrations/). Duas migrations: `..._init` (Fase 1 + plataforma/billing + auditoria) e `..._fase2_caixas_higienizacao_embalagens` (Fase 2 + novos tipos de relatório). Em produção use `prisma migrate deploy` (ver [Instalação e deploy](07-instalacao-e-deploy.md)).
