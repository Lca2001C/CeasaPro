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

### Escolha do plano no primeiro pagamento (`/assinatura`)

Empresa recém-criada nasce `SUSPENSO`, e o proxy só a deixa abrir `/assinatura` — `/plano` é área bloqueada. Sem uma escolha ali, o primeiro pagamento seria sempre no plano que o super-admin marcou no cadastro. Por isso a tela de assinatura mostra o seletor de planos **acima** do formulário de pagamento:

- lista os mesmos planos ativos de `listAvailablePlans`, com preço, limite de usuários e módulos;
- aparece só quando **não há cobrança em aberto** — com um QR já emitido, trocar de plano mostraria um preço diferente do código que a pessoa vai pagar;
- o `planId` escolhido vai junto no corpo de `POST /api/billing/checkout` e de `POST /api/billing/checkout/card`. Quem troca a assinatura é o **servidor**, em `prepareCharge` → `PlanoService.changePlan`, com as mesmas regras da seção anterior;
- o **valor cobrado sai sempre do plano no banco**, nunca do que o cliente enviou. O preço na tela é só exibição, e o Payment Brick é remontado quando muda (ele lê o valor apenas na montagem).

Duas guardas do servidor sustentam isso:
- a checagem de "mensalidade do mês já paga" roda **antes** da troca de plano, senão um pagamento recusado por esse motivo deixaria o cliente com o plano novo e sem cobrança;
- um QR PIX em aberto só é reaproveitado se o valor **ainda for o mesmo**; depois de uma troca de plano ele é cancelado e um novo é gerado, para ninguém pagar 29,90 e receber o plano de 99,90.

## Assinatura e cobrança (Mercado Pago)

- **Sem período gratuito:** empresas novas nascem em `SUSPENSO` e **não têm acesso** até o primeiro pagamento ser aprovado pelo Mercado Pago. O campo `activatedAt` marca essa primeira ativação; enquanto for nulo, nem a tolerância de `graceDays` se aplica.
- **Métodos de pagamento (tela `/assinatura`, Payment Brick unificado):**
  - **PIX:** gera a cobrança do mês; o Mercado Pago devolve QR Code + copia-e-cola. A criação usa **Idempotency-Key** (sem cobrança duplicada em retry), envia a **`notification_url`** automaticamente (quando `APP_URL` é https) e define **validade de 48h** para o QR — cobranças vencidas são canceladas e renovadas sozinhas. A rota é `POST /api/billing/checkout`.
  - **3DS em crédito e débito:** `three_d_secure_mode: "optional"` vai nos dois. Emissor brasileiro exige autenticação em compra sem cartão presente; sem o campo, o Mercado Pago não tem como negociá-la e o cartão **real** volta recusado, sem o portador ter chance de autenticar (cartão de teste passava, o que escondia o problema).
  - **Cartão de crédito e de débito (Payment Brick):** formulário do MP embutido; o cartão é **tokenizado no browser** (o servidor recebe só o token — PCI-safe) e cobrado **à vista (1x)**. A rota é `POST /api/billing/checkout/card` e a Idempotency-Key é derivada da cobrança + token, então retentar o mesmo cartão não duplica o débito. Requer `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` (sem ela a tela cai no fallback PIX-only).
  - **Débito com 3DS:** o débito exige o **CPF do titular** e envia `three_d_secure_mode: optional`. Quando o emissor pede autenticação, a cobrança fica `PENDENTE` com o desafio (`threeDsUrl`) renderizado num iframe; quem aprova de fato é o webhook.
  - **Uma cobrança viva por mês:** pagar por cartão cancela um PIX pendente do mês; e se a mensalidade do mês já está paga, novas cobranças são recusadas.
  - Todos confirmam por **webhook** (HMAC + anti-replay, idempotente por `mpPaymentId`); ao aprovar, a assinatura vira **ATIVO**, o vencimento avança 1 mês e a **tela detecta sozinha** (polling em `/api/billing/status`) — renova a sessão e libera o acesso sem recarregar. O webhook responde `200` na hora e processa depois da resposta, para o Mercado Pago não reenviar por timeout.
- **Estorno e chargeback:** se um pagamento já aprovado é revertido (`refunded`, `cancelled`), a assinatura volta para `SUSPENSO`; em `charged_back` (contestação junto ao emissor) vai para `BLOQUEADO`, que exige análise do super-admin. Nos dois casos o `currentPeriodEnd` é revertido, `statusSource` vira `MANUAL` (para a tolerância não devolver o acesso) e **as sessões ativas da empresa são revogadas**, com registro `ACCESS_REVOKED` na auditoria. Um novo pagamento aprovado devolve `statusSource` para `AUTO`.
- **Status da assinatura** (calculado em [`src/lib/billing/status.ts`](../src/lib/billing/status.ts)):
  - `ATIVO` — em dia;
  - `VENCIDO` — passou do vencimento, mas dentro da tolerância (`graceDays`): acesso liberado com **aviso**;
  - `SUSPENSO` — nunca pagou, ou passou a tolerância: **acesso bloqueado** (dados preservados);
  - `BLOQUEADO` — bloqueio manual do super-admin ou chargeback;
  - `CANCELADO` — assinatura encerrada.
  - `statusSource = MANUAL` faz o status definido pelo super-admin prevalecer sobre o cálculo automático.
- **Bloqueio imediato:** o super-admin pode suspender/bloquear a empresa (`Tenant.status`), o que **revoga as sessões ativas** na hora.
- **Cron diário** (`/api/cron/billing`, protegido por `CRON_SECRET`): reconcilia as cobranças do mês atual e do anterior direto no Mercado Pago e depois recalcula o status de todas as assinaturas (ex.: ATIVO → VENCIDO → SUSPENSO conforme as datas). A reconciliação cobre os dois sentidos: cobrança `PENDENTE` cujo webhook de aprovação se perdeu (a empresa pagou e não recebeu acesso) e cobrança `APROVADO` cujo webhook de **estorno** se perdeu (a empresa segue usando depois da reversão). Sair de `APROVADO` só é aceito com status de reversão explícito (`refunded`, `charged_back`, `cancelled`) — qualquer outra leitura da API é registrada e ignorada, para uma resposta estranha não derrubar o acesso de quem pagou.

### Recorrência: o que existe e o que não existe

Não há débito automático. A integração usa a API de **pagamentos avulsos** do Mercado Pago (`Payment`), não `preapproval`/assinaturas recorrentes: **todo mês o cliente precisa pagar de novo** pela tela `/assinatura` (PIX ou cartão). O que o sistema automatiza é a cobrança-controle — vencimento, tolerância, bloqueio, reativação e o **lembrete por e-mail** descrito abaixo. Débito recorrente continua sendo evolução em aberto.

### Lembrete de vencimento (e-mail)

O cron diário avisa por e-mail o dono da empresa **3 dias antes** do vencimento (`DUE_REMINDER_DAYS` em `billing.service.ts`), com o valor, a data e um botão que abre `/assinatura`. Antes disso o cliente só descobria o vencimento ao ser bloqueado — no meio do expediente, que é o pior momento para quem usa o sistema no balcão.

Quem recebe: assinatura `ATIVO`, com `activatedAt` (já pagou pelo menos uma vez), empresa ativa e vencimento dentro da janela. Ficam de fora, de propósito:
- **quem nunca pagou** — já vê a cobrança na tela toda vez que entra;
- **quem já venceu ou está suspenso** — o bloqueio já é o aviso;
- **empresa sem OWNER** (inclui o ambiente do super-admin) — não há para quem escrever.

**Um aviso por período.** A marca é o próprio registro de auditoria `SUBSCRIPTION_DUE_REMINDER`, procurado dentro da janela deste vencimento: sem ela o cron mandaria o mesmo e-mail três dias seguidos. Quando o cliente paga, `currentPeriodEnd` avança e o período seguinte volta a ser elegível. A marca só é gravada **depois** de o envio dar certo — falha transitória do Resend deixa o cron de amanhã tentar de novo, em vez de silenciar o aviso para sempre.

O lembrete roda **depois** do recálculo de status, senão quem acabou de ser reativado por um pagamento reconciliado receberia "vence em 3 dias" no mesmo minuto. Uma falha no envio não derruba o cron: a cobrança não depende do e-mail.

## Limites

- `maxUsers` do plano é exibido em "Meu plano" e no painel do super-admin. (Nesta versão há um usuário OWNER por empresa; limites numéricos rígidos por plano — ex.: máx. de produtos — estão previstos como evolução futura.)
