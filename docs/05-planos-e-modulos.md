# 5. Planos e módulos

O CeasaPro é um SaaS pago. Cada empresa tem **uma assinatura** vinculada a **um plano**, e o plano define **quais módulos opcionais** a empresa enxerga.

## Módulos

### Núcleo (sempre liberados)
Dashboard, produtos, fornecedores, compras, vendas/PDV, fiado, estoque, despesas, relatórios básicos, configurações, atividades, "Meu plano" e assinatura.

### Opcionais (dependem do plano)
| Chave | Módulo |
|---|---|
| `caixas` | Caixas plásticas |
| `higienizacao` | Higienização |
| `embalagens` | Venda de embalagens |
| `relatorios_avancados` | Relatórios avançados (lucro por produto, mais vendidos, inadimplentes, fornecedores, fluxo de caixa, caixas, higienização, embalagens) |

Fonte única da verdade: [`src/lib/plan/modules.ts`](../src/lib/plan/modules.ts) (registry + funções `planModules`, `moduleForPath`, `isModuleEnabled`, `requireModule`).

## Como o plano define os módulos

No cadastro/edição do plano (super-admin, `/admin/planos`), marcam-se os módulos opcionais incluídos. Isso é gravado em `Plan.features` como `{ "modules": ["caixas", "higienizacao", ...] }`.

**Retrocompatibilidade:** um plano **sem** `features.modules` definido é tratado como **todos os módulos liberados** — por isso planos antigos e a empresa demo não quebram.

## Como o módulo chega até a empresa

Ao logar (ou renovar a sessão), o sistema lê o plano da empresa e coloca a lista de módulos habilitados no **access token (JWT)**, no claim `modules` (mesmo mecanismo de `tenantStatus`/`subStatus`). Uma mudança de plano passa a valer no próximo refresh do token (≤15 min), consistente com o modelo de propagação da cobrança.

## Bloqueio em camadas (segurança em profundidade)

A regra de ouro: **o bloqueio é decidido no servidor**. Esconder do menu é apenas conforto visual.

1. **Navegação** (menu inferior e lateral): itens de módulos não incluídos ficam ocultos. Isso é só UX.
2. **Middleware** (`src/middleware.ts`): ao acessar a rota de um módulo desabilitado, páginas são redirecionadas para `/plano?bloqueado=<modulo>` e APIs recebem **403**.
3. **Servidor** (defense in depth): os wrappers `withTenantAction`/`withTenantRoute` aceitam a opção `module`; se o módulo não estiver no plano, lançam **ForbiddenError**. Aplicado nas ações de caixas, higienização e embalagens, e no export de relatórios avançados (gate por tipo de relatório).

Assim, mesmo que alguém digite a URL direto ou chame a API sem passar pelo menu, o acesso é recusado.

## Tela "Meu plano" (`/plano`)

Mostra ao dono:
- plano atual (nome, preço, situação, vencimento);
- **todos** os módulos opcionais com ✓ (incluído) ou ✗ (não incluído) e a descrição de cada um;
- limite de usuários do plano e **uso atual** (nº de produtos e usuários);
- quando chega aqui por um bloqueio (`?bloqueado=`), um aviso explicando qual recurso não está no plano, com atalho para a assinatura;
- **Trocar de plano:** lista os demais planos **ativos** (nome, preço, limite de usuários e módulos incluídos) e permite mudar com um clique (confirmação em diálogo).

### Troca de plano (autoritativa no servidor)

A troca é feita pela action `trocarPlano` (`withTenantAction`, sem gate de módulo) → `PlanoService.changePlan`, que aplica as regras **no servidor** (o cliente só envia o `planId` alvo):
- só planos **existentes e ativos**; nunca o plano atual;
- o **valor mensal vem sempre do plano** (nunca do cliente);
- o novo plano precisa **comportar o número atual de usuários** (`maxUsers`); senão a troca é recusada com mensagem clara;
- **não** altera status, vencimento nem `statusSource` (respeita eventual bloqueio manual do super-admin e o período já pago).

A mudança vale **na hora** para o acesso aos módulos — a tela chama `/api/auth/refresh` após a troca, então o claim `modules` do token é reemitido e a navegação/gating se ajustam sem esperar o TTL. O **novo valor é cobrado na próxima renovação** (não há cobrança proporcional nesta versão). Só empresas com acesso liberado (não bloqueadas) chegam a `/plano`, então a troca pressupõe assinatura ativa.

## Assinatura e cobrança (Mercado Pago)

- **Trial:** empresas novas nascem em período de teste (`TRIAL`, padrão 15 dias) — acesso liberado.
- **Métodos de pagamento (tela `/assinatura`, abas PIX | Cartão):**
  - **PIX:** gera a cobrança do mês; o Mercado Pago devolve QR Code + copia-e-cola. A criação usa **Idempotency-Key** (sem cobrança duplicada em retry), envia a **`notification_url`** automaticamente (quando `APP_URL` é https) e define **validade de 24h** para o QR — cobranças vencidas são canceladas e renovadas sozinhas.
  - **Cartão (Card Brick):** formulário do MP embutido; o cartão é **tokenizado no browser** (o servidor recebe só o token — PCI-safe) e cobrado **à vista (1x)**. Aprovação costuma ser imediata (libera na hora); pendências (3DS/análise) são resolvidas pelo webhook. A rota é `POST /api/billing/checkout/card`. Requer `NEXT_PUBLIC_MP_PUBLIC_KEY` (senão a aba Cartão nem aparece).
  - **Uma cobrança viva por mês:** pagar por cartão cancela um PIX pendente do mês; e se a mensalidade do mês já está paga, novas cobranças são recusadas.
  - Ambos confirmam por **webhook** (HMAC, idempotente por `mpPaymentId`); ao aprovar, a assinatura vira **ATIVO**, o vencimento avança 1 mês e a **tela detecta sozinha** (polling em `/api/billing/status`) — renova a sessão e libera o acesso sem recarregar.
- **Status da assinatura** (calculado em [`src/lib/billing/status.ts`](../src/lib/billing/status.ts)):
  - `TRIAL` — em teste;
  - `ATIVO` — em dia;
  - `VENCIDO` — passou do vencimento, mas dentro da tolerância (`graceDays`): acesso liberado com **aviso**;
  - `SUSPENSO` — passou a tolerância: **acesso bloqueado** (dados preservados);
  - `BLOQUEADO` — bloqueio manual do super-admin;
  - `CANCELADO` — assinatura encerrada.
  - `statusSource = MANUAL` faz o status definido pelo super-admin prevalecer sobre o cálculo automático.
- **Bloqueio imediato:** o super-admin pode suspender/bloquear a empresa (`Tenant.status`), o que **revoga as sessões ativas** na hora.
- **Cron diário** (`/api/cron/billing`, protegido por `CRON_SECRET`): recalcula o status de todas as assinaturas (ex.: ATIVO → VENCIDO → SUSPENSO conforme as datas).

## Limites

- `maxUsers` do plano é exibido em "Meu plano" e no painel do super-admin. (Nesta versão há um usuário OWNER por empresa; limites numéricos rígidos por plano — ex.: máx. de produtos — estão previstos como evolução futura.)
