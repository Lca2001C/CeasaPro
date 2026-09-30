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
| `cotacoes` | Cotações do CEASA (boletim da praça, vínculo por produto e embalagem, histórico, comparativo entre praças, alertas de flutuação) |
| `relatorios_avancados` | Relatórios avançados (lucro por produto, mais vendidos, inadimplentes, fornecedores, fluxo de caixa, caixas, higienização, embalagens) |

`cotacoes` é o único opcional que aparece **fora** do seu próprio prefixo de rota: a referência de preço entra na tela de Compra, no PDV e no Início, que são de núcleo. Nessas três o gate não é o `pathPrefixes` do proxy — é `isModuleEnabled(session.modules, "cotacoes")` no servidor, antes de consultar o boletim. Quem não contratou não paga a consulta nem vê o dado.

Fonte única da verdade: [`src/lib/plan/modules.ts`](../src/lib/plan/modules.ts) (registry + funções `planModules`, `moduleForPath`, `isModuleEnabled`, `requireModule`).

## Como o plano define os módulos

No cadastro/edição do plano (super-admin, `/admin/planos`), marcam-se os módulos opcionais incluídos. Isso é gravado em `Plan.features` como `{ "modules": ["caixas", "higienizacao", ...] }`.

**Fail-closed:** um plano **sem** `features.modules` não libera módulo opcional nenhum. Era o contrário (ausência = todos liberados, para não quebrar planos anteriores ao catálogo), e a retrocompatibilidade virou o jeito mais barato de entregar o produto inteiro de graça — qualquer plano gravado sem o campo valia como plano completo, em silêncio, porque a tela mostra recurso liberado e nada indica que aquilo não foi vendido. `AdminService.createPlan`/`updatePlan` passaram a **exigir** a lista, então "sem campo" só existe em dado antigo. Lista vazia (`{ "modules": [] }`) continua sendo a forma de dizer "só o núcleo".

## Como o módulo chega até a empresa

Ao logar (ou renovar a sessão), o sistema lê o plano da empresa e coloca a lista de módulos habilitados no **access token (JWT)**, no claim `modules` (mesmo mecanismo de `tenantStatus`/`subStatus`). Uma mudança de plano passa a valer no próximo refresh do token (≤15 min), consistente com o modelo de propagação da cobrança.

## Bloqueio em camadas (segurança em profundidade)

A regra de ouro: **o bloqueio é decidido no servidor**. Esconder do menu é apenas conforto visual.

1. **Navegação** (menu inferior e lateral): itens de módulos não incluídos ficam ocultos. Isso é só UX.
2. **Proxy** (`src/proxy.ts` — o antigo `middleware.ts` do Next 15): ao acessar a rota de um módulo desabilitado, páginas são redirecionadas para `/plano?bloqueado=<modulo>` e APIs recebem **403**.
3. **Servidor** (defense in depth): os wrappers `withTenantAction`/`withTenantRoute` aceitam a opção `module`; se o módulo não estiver no plano, lançam **ForbiddenError**. Aplicado nas ações de caixas, higienização e embalagens, e no export de relatórios avançados (gate por tipo de relatório).

Assim, mesmo que alguém digite a URL direto ou chame a API sem passar pelo menu, o acesso é recusado.

## Tela "Meu plano" (`/plano`)

Mostra ao dono:
- plano atual (nome, preço, situação, vencimento);
- **todos** os módulos opcionais com ✓ (incluído) ou ✗ (não incluído) e a descrição de cada um;
- **uso atual** (nº de produtos);
- quando chega aqui por um bloqueio (`?bloqueado=`), um aviso explicando qual recurso não está no plano, com atalho para a assinatura;
- **Trocar de plano:** lista os demais planos **ativos** (nome, preço e módulos incluídos) e permite mudar com um clique (confirmação em diálogo).

### Troca de plano (autoritativa no servidor)

A troca é feita pela action `trocarPlano` (`withTenantAction`, sem gate de módulo) → `PlanoService.changePlan`, que aplica as regras **no servidor** (o cliente só envia o `planId` alvo):
- só planos **existentes e ativos**; nunca o plano atual; **nunca** o plano interno do ambiente do super-admin (`ADMIN_PLAN_SLUG`) — recusado pelo slug, não por `active`, porque ativá-lo é um clique e ele custa R$ 0 por 50 anos;
- o **valor mensal vem sempre do plano** (nunca do cliente);
- **não** altera status, vencimento nem `statusSource` (respeita eventual bloqueio manual do super-admin e o período já pago);
- **assinatura cancelada:** recusada enquanto o período pago ainda corre (o mês foi comprado num plano e não vai renovar; o caminho é desfazer o cancelamento antes). Com o período **já encerrado** a troca é aceita e vale na hora — é o cliente voltando pela `/assinatura` com outro plano, e o pagamento limpa `cancelledAt`;
- toda troca (na hora, agendada ou desfeita) **baixa as cobranças PENDENTES cujo valor deixou de ser o devido**, no banco e no Mercado Pago (ver "Uma cobrança viva por mês").

**Quando a troca vale.** Depende de a competência corrente já estar paga:

| Competência corrente | O que acontece | Onde fica |
|---|---|---|
| em aberto (trial, vencida, primeira contratação) | vale **na hora**; o novo valor entra na próxima cobrança | `planId` / `monthlyAmount` |
| **já paga** e período em curso | **agendada** para `currentPeriodEnd` | `pendingPlanId` / `pendingPlanFrom` |

O agendamento existe porque a mensalidade compra o **mês**, e é o plano que decide quais módulos valem nesse mês. Com a troca valendo sempre na hora, quem pagasse o básico no dia 1º e subisse para o completo no dia 2 usava o mês todo pelo preço do básico — e repetindo a manobra nunca chegava a pagar o plano que usa. O downgrade é adiado pela razão simétrica: tirar na hora módulos recém-pagos seria receber o mês e entregar meio.

A troca agendada passa a valer em `PlanoService.aplicarTrocaProgramada`, chamada de onde ela tem consequência e não pode esperar o cron da tarde: `buildAccessPayload` (o claim `modules` do token), `prepareCharge` (o valor que vai ao Mercado Pago), `getPlanoView` (a tela) e `recomputeStatuses` (o cron diário). Escolher de novo o plano vigente **desfaz** o agendamento, e há também a action `cancelarTrocaDePlano`.

**Plano agendado que saiu de oferta.** O painel recusa desativar plano com troca agendada, mas existe dado gravado antes dessa trava. Para ele: `valorDevido` **ignora** o plano agendado inativo (cobra o plano vigente) e `aplicarTrocaProgramada` **descarta** o agendamento assim que o encontra — não só na data —, com registro na auditoria. As duas pontas concordam: a empresa segue no plano que vinha usando e paga o preço dele.

Quando a troca vale na hora, o acesso aos módulos acompanha: a tela chama `/api/auth/refresh` após a troca, o claim `modules` é reemitido e a navegação/gating se ajustam sem esperar o TTL. O **novo valor é cobrado na próxima renovação** (não há cobrança proporcional nesta versão). Só empresas com acesso liberado (não bloqueadas) chegam a `/plano`, então a troca pressupõe assinatura ativa.

### Escolha do plano no primeiro pagamento (`/assinatura`)

Empresa recém-criada nasce `SUSPENSO`, e o proxy só a deixa abrir `/assinatura` — `/plano` é área bloqueada. Sem uma escolha ali, o primeiro pagamento seria sempre no plano que o super-admin marcou no cadastro. Por isso a tela de assinatura mostra o seletor de planos **acima** do formulário de pagamento:

- lista os mesmos planos ativos de `listAvailablePlans`, com preço e módulos;
- aparece só quando **não há cobrança em aberto** — com um QR já emitido, trocar de plano mostraria um preço diferente do código que a pessoa vai pagar;
- o `planId` escolhido vai junto no corpo de `POST /api/billing/checkout` e de `POST /api/billing/checkout/card`. Quem troca a assinatura é o **servidor**, em `prepareCharge` → `PlanoService.changePlan`, com as mesmas regras da seção anterior;
- o **valor cobrado sai sempre do plano no banco**, nunca do que o cliente enviou. O preço na tela é só exibição, e o Payment Brick é remontado quando muda (ele lê o valor apenas na montagem).

Duas guardas do servidor sustentam isso:
- a checagem de "mensalidade do mês já paga" roda **antes** da troca de plano, senão um pagamento recusado por esse motivo deixaria o cliente com o plano novo e sem cobrança;
- um QR PIX em aberto só é reaproveitado se o valor **ainda for o mesmo**; depois de uma troca de plano ele é cancelado (no banco **e no Mercado Pago**) e um novo é gerado, para ninguém pagar 29,90 e receber o plano de 99,90. Se a idempotência do Mercado Pago devolver um QR já cancelado lá (o cliente voltou ao plano de antes), outro é pedido com chave nova.

## Assinatura e cobrança (Mercado Pago)

- **Dois caminhos de acesso, e só dois.** Empresas nascem em `SUSPENSO`. Elas saem daí por:
  - **`activatedAt`** — primeiro pagamento aprovado pelo Mercado Pago (`ATIVO`); ou
  - **`trialEndsAt` no futuro** — teste grátis de 7 dias do cadastro público (`TRIAL`), concedido na confirmação do e-mail.
- **A tolerância de `graceDays` só vale para quem já pagou.** Enquanto `activatedAt` for nulo ela não se aplica — nem para estender o teste grátis. Teste vencido vai para `SUSPENSO`, nunca para `VENCIDO`, porque `VENCIDO` libera acesso com aviso e daria dias grátis além dos 7 combinados.
- **Métodos de pagamento (tela `/assinatura`, Payment Brick unificado):**
  - **PIX fica FORA do Payment Brick.** `customization.paymentMethods` declara só `creditCard` e `debitCard`; **`bankTransfer` é omitido de propósito** — não é esquecimento, e reativá-lo traz o problema de volta. O passo de seleção do PIX dentro do Brick é do Mercado Pago e diz *"insira o e-mail para receber o código Pix"*, promessa que este fluxo não cumpre: aqui o código aparece na tela, na hora. Aquele texto roda dentro do iframe e não há como reescrevê-lo, então o caminho é não usar aquele passo.
  - **Entrada própria do PIX:** um cartão abaixo do Brick, com o botão **Gerar código PIX**, que chama `POST /api/billing/checkout` direto e abre o painel. É o mesmo comportamento do fallback PIX-only (usado quando falta a public key), então os dois caminhos ficam iguais para o cliente.
  - **O painel mostra tudo na tela:** **QR Code** e **copia-e-cola em texto** (selecionável, mais botão de copiar), com valor e validade. Basta o Mercado Pago devolver **um** dos três — imagem do QR, copia-e-cola ou `ticketUrl` — para o painel aparecer; exigir a imagem base64 deixava o cliente sem forma de pagar. Se vier vazio, a tela avisa em vez de travar. Decisão isolada em `temPagamentoPix` ([`src/lib/payments/pix-charge.ts`](../src/lib/payments/pix-charge.ts)).
  - **PIX:** gera a cobrança do mês; o Mercado Pago devolve QR Code + copia-e-cola. A criação usa **Idempotency-Key** (sem cobrança duplicada em retry), envia a **`notification_url`** automaticamente (quando `APP_URL` é https) e define **validade de 48h** para o QR — cobranças vencidas são canceladas e renovadas sozinhas. A rota é `POST /api/billing/checkout`.
  - **Identificador da forma de pagamento:** o SDK **declara** os valores em camelCase (`creditCard`) mas **emite** snake_case (`credit_card`) em runtime. `normalizarMetodoBrick` ([`src/lib/payments/brick-method.ts`](../src/lib/payments/brick-method.ts)) aceita as duas grafias — comparar com o literal do tipo derrubava todo cartão em "forma de pagamento não disponível para a mensalidade", e o PIX escapava por acaso (`bank_transfer` se escreve igual nos dois estilos). Cartão pré-pago é tratado como crédito.
  - **3DS em crédito e débito:** `three_d_secure_mode: "optional"` vai nos dois. Emissor brasileiro exige autenticação em compra sem cartão presente; sem o campo, o Mercado Pago não tem como negociá-la e o cartão **real** volta recusado, sem o portador ter chance de autenticar (cartão de teste passava, o que escondia o problema).
  - **Cartão de crédito e de débito (Payment Brick):** formulário do MP embutido; o cartão é **tokenizado no browser** (o servidor recebe só o token — PCI-safe) e cobrado **à vista (1x)**. A rota é `POST /api/billing/checkout/card` e a Idempotency-Key é derivada da cobrança + token, então retentar o mesmo cartão não duplica o débito. Requer `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` (sem ela a tela cai no fallback PIX-only).
  - **Débito com 3DS:** o débito exige o **CPF do titular** e envia `three_d_secure_mode: optional`. Quando o emissor pede autenticação, a cobrança fica `PENDENTE` com o desafio (`threeDsUrl`) renderizado num iframe; quem aprova de fato é o webhook.
  - **Uma cobrança viva por mês:** pagar por cartão cancela um PIX pendente do mês (só se o cartão **não** foi recusado — recusado, o PIX continua valendo); e se a mensalidade da competência já está paga, novas cobranças são recusadas (`MENSALIDADE_JA_PAGA`, com a exceção da renovação adiantada descrita no lembrete de vencimento).
  - **Cancelar é nos dois lados.** Toda cobrança pendente que deixa de ser a certa — QR substituído, troca de plano, cartão no lugar do PIX, assinatura cancelada, outra cobrança da competência aprovada — vira `CANCELADO` no banco (dentro da transação da decisão) e, depois do commit, é cancelada no Mercado Pago (`cancelPayment`, `PUT /v1/payments/{id}` com `status: cancelled`; [`cobrancas-pendentes.ts`](../src/lib/payments/cobrancas-pendentes.ts)). O cancelamento no gateway é de **melhor esforço**: falhou, fica no log como aviso e a reconciliação diária tenta de novo. Antes só o banco era atualizado, e o QR velho seguia pagável por 48 h no app do banco do cliente.
  - **Aprovado que não credita não some.** Um pagamento que o Mercado Pago aprova e que não compra mês — **valor menor** que a mensalidade devida (o QR antigo pago depois da troca de plano) ou **segunda aprovação** da mesma competência — fica marcado (`uncreditedAt`/`uncreditedReason` = `VALOR_MENOR`/`DUPLICADO`), sai da tela como cobrança em aberto e gera **uma** notificação `PAGAMENTO_NAO_CREDITADO` para o super-admin, com empresa, pagamento, competência e valores. O mês **não** é creditado duas vezes: a regra de `approvedKey` continua valendo. Crédito ou devolução é decisão humana.
  - Todos confirmam por **webhook** (HMAC + anti-replay, idempotente por `mpPaymentId`); ao aprovar, a assinatura vira **ATIVO**, o vencimento avança 1 mês e a **tela detecta sozinha** (polling em `/api/billing/status`) — renova a sessão e libera o acesso sem recarregar. O webhook responde `200` na hora e processa depois da resposta, para o Mercado Pago não reenviar por timeout.
- **Estorno e chargeback:** se um pagamento já aprovado é revertido (`refunded`, `cancelled`), a assinatura volta para `SUSPENSO`; em `charged_back` (contestação junto ao emissor) vai para `BLOQUEADO`. Nos dois casos o `currentPeriodEnd` é revertido (só a duração do período estornado), `statusSource` vira `MANUAL` (para a tolerância e o cron não devolverem o acesso) e **as sessões ativas da empresa são revogadas**, com registro `ACCESS_REVOKED` na auditoria — salvo se sobrar outro pagamento aprovado da mesma competência, caso em que o acesso fica.
- **Um pagamento novo desfaz o bloqueio — e avisa.** A tela `/assinatura` abre mesmo bloqueada, e um pagamento aprovado devolve a assinatura a `ATIVO` com `statusSource: AUTO`, **inclusive** a que estava `BLOQUEADO` por chargeback (ou por decisão manual do super-admin na assinatura). O comportamento é deliberado: quem pagou volta a usar, sem esperar um humano. Mas o bloqueio era uma decisão humana, então esse caso grava `STATUS_CHANGE` na auditoria (com o motivo do bloqueio antigo) e cria a notificação `BLOQUEIO_DESFEITO_POR_PAGAMENTO` para o super-admin. Se o bloqueio precisa continuar, o caminho é **bloquear a empresa** no painel (`Tenant.status`), que pagamento nenhum desfaz. Reativar um `SUSPENSO` por estorno não gera aviso — é o caminho normal.
- **Status da assinatura** (calculado em [`src/lib/billing/status.ts`](../src/lib/billing/status.ts)):
  - `ATIVO` — em dia;
  - `VENCIDO` — passou do vencimento, mas dentro da tolerância (`graceDays`): acesso liberado com **aviso**;
  - `SUSPENSO` — nunca pagou, ou passou a tolerância: **acesso bloqueado** (dados preservados);
  - `BLOQUEADO` — bloqueio manual do super-admin ou chargeback;
  - `CANCELADO` — assinatura encerrada.
  - `statusSource = MANUAL` faz o status definido pelo super-admin prevalecer sobre o cálculo automático.
- **Bloqueio imediato:** o super-admin pode suspender/bloquear a empresa (`Tenant.status`), o que **revoga as sessões ativas** na hora.
- **Vencimento (`addOneMonth`):** cada aprovação soma um mês **no calendário de Brasília** (`America/Sao_Paulo`, via `tz.ts`), mantendo a hora do dia e limitando ao último dia do mês de destino (31/01 → 28/02, 31/08 → 30/09). A conta era em UTC, e um pagamento às 22 h de 30/08 (já 31/08 em UTC) vencia em 29/09 às 22 h — um dia a menos.
- **Cron diário** (`/api/cron/billing`, protegido por `CRON_SECRET`): reconcilia as cobranças direto no Mercado Pago e depois recalcula o status de todas as assinaturas (ex.: ATIVO → VENCIDO → SUSPENSO conforme as datas). A reconciliação cobre: cobrança `PENDENTE` cujo webhook de aprovação se perdeu (a empresa pagou e não recebeu acesso); cobrança `CANCELADO` recente (validade do QR + 3 dias) que o cliente pagou mesmo assim — creditada se cobre o devido, senão vira `PAGAMENTO_NAO_CREDITADO`; se o gateway ainda a mostra em aberto, o cancelamento é tentado de novo, e ela **nunca** é reaberta; e cobrança `APROVADO` cujo webhook de **estorno** se perdeu. A janela é mês anterior, corrente e **seguinte** (renovação adiantada). Sair de `APROVADO` só é aceito com status de reversão explícito (`refunded`, `charged_back`, `cancelled`) — qualquer outra leitura da API é registrada e ignorada.
  - **Orçamento de tempo.** A rota tem 60 s (Hobby) para tudo. A reconciliação recebe uma fatia (`ORCAMENTO_RECONCILIACAO_MS`, 20 s), conferida antes de cada consulta; cada consulta tem prazo de 8 s; até **6 consultas simultâneas**, e nunca duas da mesma empresa ao mesmo tempo. Uma falha na reconciliação não derruba o resto: recálculo de status, lembretes, despesas recorrentes, limpezas e boletins rodam do mesmo jeito. O retorno informa `verificados`, `naoVerificados` e `esgotouTempo`.
  - **Rotação.** `SubscriptionPayment.lastReconciledAt` é marcado a cada consulta (mesmo na falha). Cada lote lê primeiro as nunca conferidas, das mais recentes para as mais antigas, e depois as conferidas há mais tempo — o que o prazo cortou hoje vai primeiro amanhã, e a aprovação de ontem está sempre entre as primeiras.

### Recorrência: o que existe e o que não existe

Não há débito automático. A integração usa a API de **pagamentos avulsos** do Mercado Pago (`Payment`), não `preapproval`/assinaturas recorrentes: **todo mês o cliente precisa pagar de novo** pela tela `/assinatura` (PIX ou cartão). O que o sistema automatiza é a cobrança-controle — vencimento, tolerância, bloqueio, reativação e o **lembrete por e-mail** descrito abaixo. Débito recorrente continua sendo evolução em aberto.

### Lembrete de vencimento (e-mail)

O cron diário avisa por e-mail o dono da empresa **3 dias antes** do vencimento (`DUE_REMINDER_DAYS` em `billing.service.ts`), com o valor, a data e um botão que abre `/assinatura`. Antes disso o cliente só descobria o vencimento ao ser bloqueado — no meio do expediente, que é o pior momento para quem usa o sistema no balcão.

Quem recebe: assinatura `ATIVO`, com `activatedAt` (já pagou pelo menos uma vez), empresa ativa e vencimento dentro da janela. Ficam de fora, de propósito:
- **quem nunca pagou** — já vê a cobrança na tela toda vez que entra;
- **quem já venceu ou está suspenso** — o bloqueio já é o aviso;
- **empresa sem OWNER** (inclui o ambiente do super-admin) — não há para quem escrever.

**Um aviso por período.** A marca é o próprio registro de auditoria `SUBSCRIPTION_DUE_REMINDER`, procurado dentro da janela deste vencimento: sem ela o cron mandaria o mesmo e-mail três dias seguidos. Quando o cliente paga, `currentPeriodEnd` avança e o período seguinte volta a ser elegível. A marca só é gravada **depois** de o envio dar certo — falha transitória do SMTP deixa o cron de amanhã tentar de novo, em vez de silenciar o aviso para sempre.

O lembrete roda **depois** do recálculo de status, senão quem acabou de ser reativado por um pagamento reconciliado receberia "vence em 3 dias" no mesmo minuto. Uma falha no envio não derruba o cron: a cobrança não depende do e-mail.

**O lembrete é atendível: renovação adiantada.** A guarda de "mensalidade já paga" olhava o mês do calendário, e o período pago não acompanha o calendário: quem pagou em 01/09 vence em 01/10, recebe em 28/09 "vence em 3 dias" e, pelo botão do e-mail, dava com "a mensalidade deste mês já está paga". Agora (`competenciaACobrar` em `billing.service.ts`):

- com a competência do calendário paga **e** o vencimento dentro da mesma janela do lembrete (`DUE_REMINDER_DAYS`, por dia de calendário — ou já vencido), a cobrança é da **competência do período que está sendo comprado**: `refMonthTz(currentPeriodEnd)`, ou o mês seguinte ao corrente quando esse rótulo coincide com ele (período que vence no fim do próprio mês);
- fora da janela, mês pago continua sendo mês pago (`MENSALIDADE_JA_PAGA`);
- `getStatus` usa a mesma competência, então a tela `/assinatura` oferece o pagamento e o polling reconhece a aprovação;
- o mês novo começa no vencimento antigo (adiantar não encurta nem alonga), o valor segue `valorDevido` (com troca agendada para o vencimento, é o preço do plano novo), e `approvedKey` continua garantindo um crédito por competência — pagar adiantado duas vezes vira `DUPLICADO`. O estorno do mês adiantado desconta só a duração dele.

## Limites

- **Não existe limite de usuários por plano.** O que diferencia um plano do outro são os **módulos** (`features`). Limites numéricos rígidos por plano — ex.: máx. de produtos — seguem previstos como evolução futura, mas nenhum está em vigor.
