# CeasaPro

Sistema **simples** de gestão para comercializadores do CEASA — produtos, fornecedores, compras, vendas (frente de caixa), fiado, estoque, caixas plásticas, higienização, venda de embalagens, despesas, dashboard e relatórios. Multi-empresa (SaaS) com painel de super-admin e cobrança por Mercado Pago.

> A especificação original completa está preservada em [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md).

---

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** — um único app full-stack
- **Prisma** + **PostgreSQL**
- **Tailwind CSS** + componentes próprios (estilo shadcn) — mobile-first
- Autenticação própria com **jose** (JWT) + **Argon2id**
- **Mercado Pago** (mensalidade via PIX) · **Resend** (e-mail) · **exceljs** (relatórios)
- Testes com **Vitest**

## Arquitetura (resumo)

- **Isolamento por empresa (tenant):** `getTenantPrisma(tenantId)` injeta `tenantId` automaticamente em toda consulta — impossível vazar dados entre empresas.
- **Camadas:** Server Action / Route Handler (fino) → Service (regra de negócio) → Prisma. Todas as fórmulas financeiras ficam em `FinancialCalcService`.
- **API híbrida:** CRUD simples via **Server Actions**; áreas transacionais (vendas/PDV, compras, estoque, fiado, relatórios, Mercado Pago) via **Route Handlers** (`/api/*`).
- **Papéis:** `SUPER_ADMIN` (plataforma) e `OWNER` (empresa).
- **Auditoria:** toda operação financeira grava em `audit_logs` (quem/quando/antes-depois).
- **Estoque e caixas plásticas são derivados** de livros-razão (`stock_movements`, `plastic_crate_movements`) — auditável, sem coluna mutável de saldo.

Estrutura em [`src/`](src/): `app/` (telas + rotas), `actions/` (Server Actions), `lib/services/` (regras), `lib/db/` (Prisma + isolamento), `lib/reports/` (relatórios), `components/`.

## Módulos

| Área | Módulos |
|---|---|
| Operação | Produtos · Fornecedores · Compras (entrada de estoque + frete rateado) · Vendas/PDV · Fiado (pagamento parcial) · Estoque (quebra/perda/doação) |
| Fase 2 | Caixas plásticas (entrada/saída/retorno/quebra + saldos) · Higienização (envio/devolução/pagamento) · Venda de embalagens (tipos + vendas) |
| Financeiro | Despesas (fixas/variáveis + categorias) · Dashboard (com avisos + indicadores avançados) · 13 relatórios (básicos + lucro por produto, mais vendidos, inadimplentes, fornecedores, fluxo de caixa, caixas, higienização, embalagens) |
| SaaS | Onboarding guiado · Configurações da empresa · Assinatura (PIX Mercado Pago, trial, bloqueio) · Painel super-admin (clientes, planos, pagamentos, auditoria) |
| Fase 3 | **PWA instalável** (manifest + service worker leve) · **Avisos** no painel (fiado vencido, despesas a vencer, higienização a pagar) · **Atividades/Auditoria** (empresa e plataforma) · Métricas avançadas (margem, mais vendidos, prejuízo, estoque parado, MRR, novos no mês) |

---

## Pré-requisitos

- **Node.js 20+**
- **Docker** (para o PostgreSQL local) — ou um PostgreSQL já instalado
- Contas (para produção): Neon, Vercel, Resend, Mercado Pago

## Início rápido (scripts prontos)

Os scripts abaixo fazem **tudo sozinhos**: sobem o banco (Docker), instalam dependências, geram o Prisma, aplicam migrations, populam os dados iniciais (só na 1ª vez) e então iniciam o sistema. Rode-os a partir da raiz do projeto.

**Modo desenvolvimento** (com recarga automática):

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```
```bash
# Linux / macOS / Git Bash
bash scripts/dev.sh
```

**Modo produção** (build + servidor otimizado):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1   # Windows
```
```bash
bash scripts/start.sh                                        # Linux/macOS/Git Bash
```

> Feche qualquer servidor já rodando antes de iniciar outro (no Windows, um `dev` aberto trava a geração do Prisma). Se `DATABASE_URL` apontar para um banco remoto (ex.: Neon), o passo do Docker é ignorado automaticamente.

---

## Instalação manual (passo a passo)

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
#   Gere segredos fortes para JWT_ACCESS_SECRET / JWT_REFRESH_SECRET:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Subir o banco (PostgreSQL via Docker)
docker compose up -d

# 4. Criar as tabelas
npx prisma migrate dev

# 5. Popular dados iniciais (super-admin + plano + empresa demo)
npm run db:seed

# 6. Rodar
npm run dev
```

Acesse http://localhost:3000.

### Acessos criados pelo seed

- **Super-admin:** `admin@ceasapro.com.br` / senha definida em `SEED_SUPERADMIN_PASSWORD` (padrão `ceasapro123`)
- **Empresa demo** (se `SEED_DEMO=true`): `demo@ceasapro.com.br` / `demo123`

---

## Scripts

| Script | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção (roda `prisma generate` antes) |
| `npm start` | Servidor de produção |
| `npm run typecheck` | Checagem de tipos |
| `npm test` | Testes (unit + integração) |
| `npm run prisma:migrate` | Criar/aplicar migration (dev) |
| `npm run prisma:deploy` | Aplicar migrations (produção) |
| `npm run db:seed` | Popular dados iniciais |

## Testes

```bash
npm test                  # tudo
npm run test:unit         # cálculos financeiros (sem banco)
npm run test:integration  # isolamento por tenant + fluxos (usa o Postgres)
```

Os testes de integração exigem o banco de pé (`docker compose up -d`). Eles criam empresas próprias e limpam ao final.

---

## Deploy (baixo custo)

**App na Vercel + Banco no Neon + E-mail no Resend.**

1. **Banco (Neon):** crie um projeto Postgres. Copie a *connection string* **pooled** para `DATABASE_URL` e a **direct** para `DIRECT_URL`.
2. **Vercel:** importe o repositório. Configure todas as variáveis do `.env.example` em *Production* (e *Preview*). Gere segredos com `openssl rand -base64 32`.
3. **Migrations em produção:** rode `npm run prisma:deploy` no pipeline de release (usa `DIRECT_URL`) — nunca `migrate dev` em produção.
4. **Seed inicial** (uma vez): `npm run db:seed` apontando para o banco de produção (defina `SEED_SUPERADMIN_*`).
5. **Mercado Pago:** configure `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`. No painel do Mercado Pago, aponte o webhook para `https://SEU_DOMINIO/api/webhooks/mercadopago`.
6. **Cron de cobrança:** o [`vercel.json`](vercel.json) já agenda `/api/cron/billing` (protegido por `CRON_SECRET`) diariamente.
7. **E-mail:** verifique o domínio no Resend e configure `RESEND_API_KEY` / `EMAIL_FROM`.

## Backup (recomendado)

- **Neon:** ative o *backup automático diário* e o *point-in-time restore* (disponível no plano do Neon).
- **Exportação mensal:** agende um `pg_dump` mensal e envie o arquivo para um storage (Cloudflare R2 / S3) como cópia fria.

---

## Observações desta versão

- **Relatórios:** exportação em **Excel (.xlsx)** e **impressão / salvar como PDF** pelo navegador (botão *Imprimir / PDF*). Filtro por período em todos.
- **PWA:** o app é instalável na tela inicial do celular (Chrome/Android: "Adicionar à tela inicial"). O service worker cacheia apenas assets estáticos — dados financeiros vão sempre à rede (sem risco de informação desatualizada). Para regenerar os ícones: `node scripts/generate-icons.mjs`.
- **Notificações:** avisos em tempo real dentro do painel (fiado vencido, despesas a vencer/vencidas, higienização a pagar). Push externo (WhatsApp/web push) fica como evolução futura.
