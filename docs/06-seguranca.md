# 6. Segurança

A segurança do CeasaPro se apoia em quatro pilares: **autenticação forte**, **isolamento por empresa à prova de esquecimento**, **autorização decidida no servidor** e **auditoria**.

## Autenticação

- **Senhas** com **Argon2id** (`@node-rs/argon2`) — padrão OWASP. Hash só roda no Node (nunca no Edge).
- **Access token**: JWT curto (~15 min), assinado com `JWT_SECRET` (via `jose`), em cookie `httpOnly`, `Secure` (em produção) e `SameSite=Lax`.
- **Refresh token**: valor **opaco e aleatório**, guardado **apenas como hash** (`SHA-256`) na tabela `refresh_tokens`; **rotacionado** a cada uso. Isso permite **revogação real** — logout, troca de senha e bloqueio de empresa invalidam sessões.
- **Rate limit** no login (5 tentativas / 15 min por IP+e-mail) e nas demais rotas de autenticação. O contador é **persistido no Postgres** (tabela `rate_limits`, `src/lib/security/rate-limit-db.ts`), então vale **entre instâncias** — em serverless um contador em memória não seguraria força bruta. A chave (que contém IP e e-mail) é gravada só como SHA-256, e o incremento é atômico (`INSERT … ON CONFLICT`), para não perder contagem sob concorrência. No login, **só tentativa malsucedida consome a janela**: acertar a senha zera o contador, senão a mesma pessoa entrando de dois aparelhos trancaria a própria conta.
- Respostas de login/recuperação são **genéricas** (não revelam se o e-mail existe).
- Recuperação de senha: token de uso único com expiração de 1 hora; ao redefinir, revoga todas as sessões.

Arquivos: [`src/lib/auth/`](../src/lib/auth/) (`password.ts`, `jwt.ts`, `session.ts`, `refresh.ts`, `cookies.ts`, `build-session.ts`).

## Isolamento por empresa (multi-tenant)

- `getTenantPrisma(tenantId)` injeta automaticamente `tenantId` (e `deletedAt: null`) em todas as consultas dos módulos de negócio — é **impossível esquecer** o filtro.
- O `tenantId` vem **sempre da sessão verificada (JWT)**, nunca de um parâmetro do cliente. Uma tentativa de forjar `tenantId` no corpo da requisição é ignorada (o valor da sessão prevalece).
- O `prisma` cru só é usado onde faz sentido cruzar empresas: autenticação, super-admin, billing/webhooks e auditoria.
- **Testado automaticamente:** `tests/integration/tenant-isolation.test.ts` garante que a empresa A não lê, edita nem exclui dados da empresa B (retorna vazio/0 linhas), e que `create` sempre grava o tenant da sessão.

## Autorização

- **Papéis** (`SUPER_ADMIN`, `OWNER`) verificados por `requireRole`/`requireSuperAdmin`/`requireTenant`.
- **Middleware** (Edge) roteia por área: `/admin/*` só para super-admin; área da empresa exige um usuário **com tenant na sessão**.

### Ambiente próprio do super-admin

O super-admin pode usar o sistema (não só administrá-lo) pelo botão **Usar o sistema**, no painel. Ele abre um tenant **dele**, provisionado sob demanda por `AdminService.getOrCreateAdminWorkspace`.

O ponto de segurança é o que esse acesso **não** é: ele não entra no ambiente de nenhum cliente. `requireTenant` continua tirando o `tenantId` da sessão verificada, então o super-admin lê e escreve apenas no próprio tenant — o isolamento multi-tenant descrito acima vale igual para ele. Dos clientes, o painel mostra cadastro e cobrança; o movimento operacional (vendas, fiado, estoque) segue fora de alcance, que é o que a LGPD espera de um operador.

Detalhes que sustentam isso:
- a assinatura do ambiente nasce `ATIVO` com `statusSource: MANUAL` e vencimento distante — MANUAL faz `computeStatus` respeitar o valor, então o cron não expira o ambiente;
- `buildAccessPayload` não aplica gate de plano nem de cobrança ao `SUPER_ADMIN`: quem administra a plataforma não pode ser expulso dela por mensalidade;
- o tenant é **excluído das métricas e da lista de clientes** (`NAO_E_AMBIENTE_ADMIN`, em `admin.service.ts`), senão o painel mentiria sobre o próprio negócio. Ele também não pode ser aberto como se fosse um cliente;
- o plano interno usado por ele é criado **inativo**, então nunca é ofertado a um cliente;
- dentro do sistema, uma faixa permanente e o botão **Gestão do sistema** deixam claro que aquele não é o ambiente de um cliente.
- **Gating por plano** decidido no servidor (middleware + `requireModule` nos wrappers e no export de relatórios). Ver [Planos e módulos](05-planos-e-modulos.md). Esconder do menu é apenas UX; a barreira real é server-side (há teste cobrindo o guard).
- **Bloqueio por assinatura**: `middleware` + `requireActiveSubscription` (no wrapper) impedem uso quando a conta está suspensa/bloqueada, exceto as rotas de regularização (`/assinatura`, `/conta/suspensa`, `/api/billing`, `/api/auth`).

## Webhook de pagamento

- O webhook do Mercado Pago valida a **assinatura HMAC** (`x-signature`) com `MERCADOPAGO_WEBHOOK_SECRET` (comparação `timingSafeEqual`) e recusa timestamps fora de uma janela de 5 min (**anti-replay**), busca o pagamento real na API (nunca confia no corpo) e é **idempotente** (chave única `mpPaymentId`). Estorno e chargeback bloqueiam a assinatura e **revogam as sessões ativas** da empresa. Ver [`src/lib/payments/mercadopago.ts`](../src/lib/payments/mercadopago.ts).
- O cron (`/api/cron/billing`) exige `Authorization: Bearer ${CRON_SECRET}`.

## Validação de entrada

- **Zod** em cliente e servidor com o **mesmo schema** (DTOs em [`src/lib/validations/`](../src/lib/validations/)). O servidor sempre revalida — nunca confia no cliente.

## Auditoria

- Ações sensíveis (criar/editar/excluir/pagar/mudança de status/login) gravam em `audit_logs` com autor, IP, data e **antes/depois**, dentro da transação da operação. Consulta em `/atividades` (empresa) e `/admin/auditoria` (global).

## Cabeçalhos e logs

- **Headers de segurança** configurados em [`next.config.ts`](../next.config.ts) e aplicados a todas as rotas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `X-DNS-Prefetch-Control` e **HSTS** (em produção). Um **Content-Security-Policy** estrito (com nonce) fica como evolução recomendada.
- **Logs com redação** (`pino`): senha, tokens, cookies e payloads de pagamento nunca aparecem em log. Erros ao usuário são genéricos, com um `errorId` para diagnóstico.

## Segredos e configuração

- Segredos ficam em variáveis de ambiente; `.env` está no `.gitignore` (apenas `.env.example` é versionado). Gere segredos fortes (`openssl rand -base64 32`). Ver [Instalação e deploy](07-instalacao-e-deploy.md).

## Propagação de mudanças (nota)

Alterações de status de assinatura/plano/módulos valem no **próximo refresh do token** (≤15 min), pois o `middleware` decide a partir dos claims do JWT (rápido, sem tocar no banco). Para efeito imediato de bloqueio, o super-admin usa a suspensão/bloqueio da empresa, que **revoga as sessões** na hora.

## Boas práticas já cobertas / evoluções

- Cobertas: hashing forte, tokens rotativos/revogáveis, isolamento automático, gating server-side, webhook assinado e idempotente, auditoria, validação dupla, rate limit no login compartilhado entre instâncias.
- Evoluções recomendadas: **RLS (Row-Level Security)** no PostgreSQL como segunda barreira do banco; verificação de força de senha.

## Dependências vulneráveis

Estado atual: **`npm audit` → 0 vulnerabilidades**.

O que estava aberto e como foi fechado (11/09/2026):

| pacote | chega aqui por | era | virou | advisory |
|---|---|---|---|---|
| `deepmerge-ts` | `prisma` → `@prisma/config` | 7.1.5 | **8.0.2** | GHSA-ggr8-5vv4-36mx (alta) |
| `uuid` | `exceljs` | 8.3.2 | **11.1.1** | GHSA-w5hq-g745-h8pq (moderada) |

### Por que NÃO se usou `npm audit fix --force`

Para as duas advisories, a correção que o npm oferecia era um **downgrade**:
`prisma` para 6.12.0 e `exceljs` para 3.4.0 — os dois major para trás. Isso não
conserta nada: troca uma falha conhecida por um salto para trás em duas peças
centrais (o ORM e o gerador de relatório), perdendo junto todas as correções do
intervalo, inclusive de segurança.

O conserto correto é o inverso — manter `prisma` e `exceljs` onde estão e
empurrar a transitiva vulnerável para CIMA, que é o que o campo `overrides` do
npm existe para fazer:

```json
"overrides": {
  "exceljs": { "uuid": "^11.1.1" },
  "@prisma/config": { "deepmerge-ts": "^8.0.2" }
}
```

Os overrides são **escopados** ao pacote que puxa a transitiva, e não postos na
raiz. Hoje dá no mesmo (cada um tem um único dependente), mas um `"uuid": "^11"`
solto forçaria a versão para qualquer dependente futuro — inclusive um que
precise legitimamente da 8 — e o dia em que isso acontecer é o dia em que
ninguém vai lembrar de reescopar.

### Alcance real, medido antes de mexer

Vale registrar, porque muda a leitura da gravidade:

- **`uuid`**: a falha é em **v3/v5/v6 quando `buf` é passado**. O `exceljs` usa
  **apenas `v4`**, sem argumentos (`cf-rule-ext-xform.js`, formatação
  condicional). O caminho vulnerável **nunca era alcançado** por este projeto.
- **`deepmerge-ts`**: esgotamento de pilha ao mesclar grafos recursivos. Chega
  aqui pelo carregador de configuração do **CLI do Prisma**, que mescla o nosso
  próprio `prisma.config.ts` em tempo de build/CLI. Não há entrada de usuário
  nesse caminho.

Ou seja: nenhuma das duas era explorável a partir da aplicação. Foram corrigidas
mesmo assim — alcance é mitigação, não conserto, e depender de "o exceljs hoje
só chama `v4`" é apostar que a próxima versão dele não vai chamar `v5`.

### O risco que a correção introduziu, e como foi verificado

Pular `uuid` de 8 para 11 atravessa três majors. A API do `v4` não mudou, mas o
**formato de módulo** poderia ter: o `exceljs` é CommonJS e faz
`require("uuid")`; se a 11 fosse só ESM, o relatório em Excel quebraria **em
produção e não no build**, porque o carregamento é em tempo de execução. A 11.1.1
ainda publica CJS (`"require": "./dist/cjs/index.js"`), e isso está preso em
teste.

Verificação feita, e não presumida:

- geração e releitura de um `.xlsx` exercitando o caminho de formatação
  condicional, que é o único que chama `uuidv4()`;
- `prisma validate`, que carrega a config pelo `@prisma/config` → `deepmerge-ts`;
- suíte completa: lint, tipos, 1519 unit+integração, 19 de componente, 158 E2E
  (inclui `relatorios-export.spec.ts`, que baixa um Excel de verdade) e build.

### A trava

`tests/unit/dependencias-vulneraveis.test.ts` prende os pisos de versão, a
presença dos overrides e o escopo deles. Existe porque `overrides` é silencioso:
apagar o campo não quebra build, nem tipo, nem nenhum outro teste — só reinstala
a versão vulnerável. O teste também falha se alguém rodar
`npm audit fix --force` e derrubar `prisma`/`exceljs` para trás.

**Não** há passo de `npm audit` no CI, de propósito: ele ficaria vermelho por
advisory nova publicada em dependência de terceiro, sem relação com o que o PR
mudou, e o desfecho conhecido disso é gente aprendendo a ignorar CI vermelho. A
varredura contínua fica com o Dependabot, que abre PR com contexto.
