---
name: auditar-ceasapro
description: Audita o diff do CeasaPro contra as regras de negócio e de segurança deste código e dá um veredito APROVADO, REPROVADO ou INCONCLUSIVO. Use só quando o usuário pedir auditoria, revisão do diff ou verificação depois de implementar.
user-invocable: true
disable-model-invocation: true
---

# Auditar o diff do CeasaPro

## Limites

Esta auditoria é **só leitura**:

- Não edite arquivo, não commite, não faça stash nem checkout.
- Não rode `npm run test:integration` nem nada que toque banco. Não conecte em banco remoto, não leia `.env*` para usar credencial.
- Pode rodar: `git status`, `git diff`, `git log`, `git show`, leitura de arquivos e busca. `npm run typecheck`, `npm run lint` e `npm run test:unit` só se o usuário pedir.
- Não exponha segredo: se o diff tiver token, senha, chave ou `DATABASE_URL`, cite o arquivo e a linha e escreva `[segredo omitido]`.

## Procedimento

1. Rode `git status` e `git diff` (e `git diff --staged`). Se o usuário indicar branch ou commit, use `git diff <base>...HEAD`. Liste arquivos novos não rastreados e leia-os inteiros.
2. Classifique cada arquivo tocado por área e aplique a skill correspondente como **checklist**, lendo o arquivo da skill:
   - venda, PDV, compra, estoque, fiado, despesa, embalagem, caixa, higienização, lucro, relatório financeiro → `.claude/skills/dinheiro-e-estoque/SKILL.md`
   - billing, plano, assinatura, webhook, cron, `modules.ts`, `features-vigentes.ts`, proxy de módulo → `.claude/skills/cobranca/SKILL.md`
   - cotações, CeasaNews → `.claude/skills/boletim/SKILL.md` e a referência do assunto
   - model, migration, action, rota, tela, menu, relatório, página pública → `.claude/skills/implementar-ceasapro/SKILL.md`
3. Confira, em todo o diff, além das skills:
   - **Tenant:** módulo de negócio usa `getTenantPrisma(tenantId)`; `prisma` cru só nos lugares permitidos (`docs/CONTEXTO-AGENTE.md` §3.1). `tenantId` só de `ctx`/sessão — procure `tenantId` vindo de `body`, `searchParams`, `params`, `formData` ou schema Zod de entrada.
   - **Model novo** com `tenantId` está em `TENANT_MODELS` (`src/lib/db/models-tenant.ts`) e em `cleanupTenants` (`tests/helpers/factory.ts`); com `deletedAt`, também em `SOFT_DELETE_MODELS`.
   - **Rota de escrita** usa `withTenantRoute`/`withAdminRoute` (que chamam `assertMesmaOrigem` e exigem `Content-Type: application/json`). Handler `POST`/`PUT`/`PATCH`/`DELETE` em `src/app/api/auth/*` sem wrapper chama `recusaDeOutraOrigem` (`src/lib/http/mesma-origem.ts`). Os `GET` de navegação dali (`google`, `google/callback`, `renovar`) não usam e não são achado — o OAuth se protege por `state`/PKCE. Fora de `/api/auth`, `/api/webhooks` e `/api/cron`, handler de escrita exportado cru, sem envelope, é achado.
   - **Webhook** (`src/app/api/webhooks/`): `verifyWebhookSignature` antes de qualquer efeito, sem bypass por `NODE_ENV`, pagamento relido com `getPayment`, idempotência por `mpPaymentId`.
   - **Cliente:** arquivo com `"use client"` não importa `@/lib/money`, `node:crypto`, `jose`, `@/lib/db/*` nem service. Siga a cadeia de import se for de um arquivo local.
   - **Gate:** rota/página nova de módulo opcional tem `module:` no wrapper e `requirePagina({ modulo })` no `layout.tsx`; prefixo novo em `PUBLIC_PREFIXES` tem justificativa.
   - **Transação:** escrita em 2+ tabelas dentro de `$transaction`, com `audit()` dentro.
4. Para cada suspeita, abra o código em volta e confirme antes de registrar. Procure teste que cubra o caso.

## Achados

Um bloco por achado:

```
### <título curto>
- Arquivo: `caminho:linha`
- Regra: <regra violada e onde ela mora — skill, arquivo ou §do CONTEXTO>
- Cenário: <entrada/estado concreto → resultado errado>
- Classificação: confirmado | provável | inconclusivo
```

- **confirmado:** você leu o caminho de código e o cenário acontece.
- **provável:** o código indica o problema, mas depende de algo fora do diff que você não conseguiu ver.
- **inconclusivo:** não dá para decidir só lendo (precisa de banco, de teste de integração ou de dado de produção). Diga o que resolveria.

Ordene do mais grave ao menos grave. Sem achado numa área, diga em uma linha que a área foi conferida.

## Veredito

Termine com uma linha:

- **APROVADO** — nenhum achado confirmado nem provável.
- **REPROVADO** — pelo menos uma violação **confirmada**. Sem confirmado, não reprove.
- **INCONCLUSIVO** — há achado provável ou inconclusivo que impede afirmar que está correto.

Depois do veredito, liste os testes que o autor deveria rodar localmente (unit, integration contra Postgres local, e2e), tirados das skills das áreas tocadas.
