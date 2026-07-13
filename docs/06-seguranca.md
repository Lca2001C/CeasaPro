# 6. Segurança

A segurança do CeasaPro se apoia em quatro pilares: **autenticação forte**, **isolamento por empresa à prova de esquecimento**, **autorização decidida no servidor** e **auditoria**.

## Autenticação

- **Senhas** com **Argon2id** (`@node-rs/argon2`) — padrão OWASP. Hash só roda no Node (nunca no Edge).
- **Access token**: JWT curto (~15 min), assinado com `JWT_ACCESS_SECRET` (via `jose`), em cookie `httpOnly`, `Secure` (em produção) e `SameSite=Lax`.
- **Refresh token**: valor **opaco e aleatório**, guardado **apenas como hash** (`SHA-256`) na tabela `refresh_tokens`; **rotacionado** a cada uso. Isso permite **revogação real** — logout, troca de senha e bloqueio de empresa invalidam sessões.
- **Rate limit** no login (5 tentativas / 15 min por IP+e-mail).
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
- **Middleware** (Edge) roteia por área: `/admin/*` só para super-admin; área da empresa exige OWNER com tenant.
- **Gating por plano** decidido no servidor (middleware + `requireModule` nos wrappers e no export de relatórios). Ver [Planos e módulos](05-planos-e-modulos.md). Esconder do menu é apenas UX; a barreira real é server-side (há teste cobrindo o guard).
- **Bloqueio por assinatura**: `middleware` + `requireActiveSubscription` (no wrapper) impedem uso quando a conta está suspensa/bloqueada, exceto as rotas de regularização (`/assinatura`, `/conta/suspensa`, `/api/billing`, `/api/auth`).

## Webhook de pagamento

- O webhook do Mercado Pago valida a **assinatura HMAC** (`x-signature`) com `MP_WEBHOOK_SECRET` (comparação `timingSafeEqual`), busca o pagamento real na API (nunca confia no corpo) e é **idempotente** (chave única `mpPaymentId`). Ver [`src/lib/payments/mercadopago.ts`](../src/lib/payments/mercadopago.ts).
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

- Cobertas: hashing forte, tokens rotativos/revogáveis, isolamento automático, gating server-side, webhook assinado e idempotente, auditoria, validação dupla, rate limit no login.
- Evoluções recomendadas: **RLS (Row-Level Security)** no PostgreSQL como segunda barreira do banco; rate limit distribuído (Upstash) para múltiplas instâncias; verificação de força de senha.
