# Auditoria de ponta a ponta — 2026-09-23

Varredura em quatro frentes, em paralelo: isolamento de tenant, proxy/auth/sessão, cobrança/Mercado Pago/transações e PWA/desempenho/React. Todo achado abaixo foi **confirmado lendo o código**; o que não se confirmou foi descartado. Cada correção tem teste que falha no código anterior.

Linha de base antes das mudanças: unit 988/988, integração 596/596.
Depois: unit 990/990, componentes 19/19, integração 608/608, `tsc` e `eslint` limpos.

---

## 1. Corrigido

### [CRÍTICO] Dois cliques em "Pagar" no cartão creditavam dois meses

`billing.service.ts` — o `upsert` da cobrança de cartão (e o do PIX) punha `status: PENDENTE` e `approvedKey: null` **sem olhar o status atual**. Dois POSTs com o mesmo token passam juntos por `prepareCharge`; o Mercado Pago devolve o MESMO pagamento pela chave de idempotência; o segundo `upsert` reabria a linha já APROVADA, e o webhook seguinte a aprovava de novo — `currentPeriodEnd` subia mais um mês. Não havia "outra aprovada" para barrar, porque era a mesma linha.

**Correção:** `gravarCobranca` substitui o `upsert`. Só reabre linha em `PENDENTE`/`RECUSADO`/`CANCELADO` (`updateMany` com filtro de status, atômico na linha); APROVADO e ESTORNADO voltam como estão.
**Teste:** `billing-flow.test.ts` › "dois cliques com o mesmo token…" (barreira força a corrida).

### [ALTO] Troca de plano agendada era contornável

A correção de 22/09 agendava a troca só se a **competência do calendário** estivesse paga, mas o período pago é contínuo:

- (a) Pagar o básico em 31/08 (período até 30/09), subir para o completo em 01/09 — setembro sem pagamento, então valia na hora — e usar o mês inteiro pelo preço do básico.
- (b) Com a troca agendada, pagar a renovação antes da virada cobrava `monthlyAmount` do plano **antigo** pelo período do plano **novo**.

**Correção:** `plano.service.ts` agenda quando há período pago correndo (`activatedAt` e `currentPeriodEnd > now`). `valorDevido()` decide o valor pelo período que a aprovação compra (plano agendado quando `pendingPlanFrom` ≤ início do período); é usado para gerar a cobrança **e** para conferir o valor no webhook, para as duas pontas concordarem.
**Testes:** `plano-troca-agendada.test.ts` › "O período pago protege…". Três testes antigos codificavam a brecha (a) e foram reescritos para o estado "trial/nunca pagou".

> ⚠️ Mudança de regra de negócio: quem tem período pago correndo e troca de plano agora vê a troca **agendada**, mesmo sem pagamento no mês do calendário.

### [MÉDIO] Estorno de mês anterior apagava o mês pago depois

A reversão fazia `currentPeriodEnd = payment.periodStart`. Com agosto e setembro pagos, estornar agosto devolvia o vencimento a 10/08. **Correção:** `periodoSemOEstornado` desconta só a duração do período estornado (igual ao anterior quando ele é o último).
**Teste:** `mercadopago-refund-chargeback.test.ts` › "Estorno de um mês ANTERIOR".

### [MÉDIO] Extensão de tenant deixava passar operações que não conhecia

`tenant-prisma.ts` só escopava as operações listadas; o resto ia cru. Prisma 6.19 tem `updateManyAndReturn` e `createManyAndReturn` em todo model: `getTenantPrisma(a).sale.updateManyAndReturn({...})` atualizaria vendas de **todas** as empresas. Nenhum código usa hoje.

**Correção:** as duas entram nas listas, e operação desconhecida num model de tenant agora **lança erro** (nega por padrão). `update` também remove a relação `tenant: { connect }`, não só o escalar `tenantId`.
**Testes:** `tenant-isolation.test.ts` (3 casos novos).

### [MÉDIO] Login pelo Google com apelido de e-mail criava empresa e trial novos

`google-login.service.ts` buscava pelo e-mail literal. Cadastro como `dono+box@gmail.com` + "Entrar com Google" como `dono@gmail.com` = empresa vazia com mais 7 dias de teste. **Correção:** busca também por `emailIdentity`; o Google comprovou a caixa, então vincula à conta existente.
**Teste:** `google-login.test.ts` › "apelido do mesmo Gmail…".

### [MÉDIO] Cadastro sem e-mail confirmado era mandado pagar a 1ª mensalidade

Se o e-mail de confirmação caía no spam, `/conta/suspensa` dizia "Falta só o pagamento", e nada reenviava a confirmação.

**Correção:**
- `consumeResetToken` vale como confirmação de e-mail. O link chegou na caixa, então confirma e libera o trial pendente, com o mesmo filtro de `confirmEmail`.
- A tela mostra "Confirme seu e-mail" com botão para `/recuperar-senha`.
- Contas criadas pelo admin já nascem confirmadas e não ganham trial.

**Testes:** `password-reset-flow.test.ts` › "vale como confirmação de e-mail".

### [MÉDIO] `/conta/suspensa` dizia "teste ativo, entre de novo" para quem cancelou ou foi bloqueado

`motivoDoBloqueio` só olhava datas: entrar de novo devolvia à mesma tela, num laço. **Correção:** bloqueio manual / empresa não ativa → "bloqueado"; cancelado no trial → "teste terminou".
**Teste:** `billing-trial.test.ts`.

### [MÉDIO] Senha podia ir parar na URL

Os cinco formulários de `(auth)` não tinham `method`. Um toque antes da hidratação (3G, ou nonce da CSP falhando) fazia o envio nativo por GET: `/login?email=…&password=…`, que fica no histórico e no log da Vercel. **Correção:** `method="post"`.

### [MÉDIO] Login sem limite por IP (password spraying)

Só havia `ip+email` e `email`. **Correção:** `login:ip:<ip>`, com 60 tentativas por 15 min, sem liberar no acerto e fora do cálculo quando o IP é desconhecido.

### [MÉDIO] Snapshot offline e push sobreviviam à troca de usuário

- O snapshot só era apagado pelo botão "Sair". Sessão expirada ou senha trocada em outro aparelho deixavam o estoque e o fiado legíveis em `/consulta-offline`.
- O debounce de 5 min herdado atrasava o snapshot do próximo usuário.
- O push seguia entregando o resumo da empresa anterior.

**Correção:**
- A tela de login apaga snapshot e debounce ao montar.
- O logout cancela a inscrição de push (DELETE + `unsubscribe`) e tem timeout de 10 s.
- O snapshot passa `modules` para o resumo: sem eles, `contasPagar` saía sem a higienização.

### [MÉDIO] Excluir fiado de venda mista apagava o PIX recebido

`FiadoService.remove` só olhava pagamentos do fiado; numa venda meio PIX, meio fiado, a venda inteira ia para `deletedAt` e o PIX sumia do fluxo de caixa. **Correção:** recusa quando a venda tem parcela fora do fiado; a checagem de "sem pagamento" passou para dentro da transação (`updateMany where paidAmount = 0`).
**Teste:** `fiado-crud.test.ts` › "venda mista".

### [MÉDIO] Ambiente interno do super-admin podia ser excluído/bloqueado

`deleteTenant` desativava todos os usuários da empresa — inclusive o próprio SUPER_ADMIN. **Correção:** `recusarAmbienteAdmin` em `deleteTenant` e `setTenantStatus`.
**Teste:** `admin-workspace.test.ts`.

### [MÉDIO] Índices

- `audit_logs(createdAt)`: `/admin/auditoria` fazia scan completo.
- `stock_movements(tenantId, sourceType, sourceId)`: detalhe da venda e exclusão de fiado varriam o livro-razão.

Migration `20260923142829_indices_auditoria_e_origem_estoque` (só `CREATE INDEX`).

### [BAIXO]
- **Link de reset no log em produção:** sem SMTP, `/api/auth/forgot` logava o link que toma a conta. Agora só fora de produção.
- **Parcelamento:** o servidor aceitava até 12x; o Brick já trava 1x. Agora o schema também exige 1x.
- **Fiado com 3 casas:** `10,005` deixava a conta EM_ABERTO com saldo zero para sempre. Agora o limite é 2 casas.
- **`BILLING_SAFE_PREFIXES` sem fronteira:** usava `startsWith` puro. Agora segue a mesma regra de `isPublic`.
- **Código morto perigoso:** `AuditLogService.listForTenant` (com `tenantId` vazio devolvia a auditoria de todas as empresas) foi removido, e o briefing deixou de descrever `/atividades`, que não existe desde `f644e78`.

---

## 2. Pendente (confirmado, não corrigido nesta rodada)

> **Atualização 2026-09-30:** todos os itens abaixo foram corrigidos, exceto a mensagem do 401 do Mercado Pago, mantida por decisão deliberada. Detalhes em [auditoria-2026-09-30.md §4](auditoria-2026-09-30.md#4-pendências-das-duas-rodadas--resolvidas-em-2026-09-30).

Ordenado por prioridade. São mudanças maiores, dependem de sandbox do Mercado Pago ou pedem decisão de produto.

| Sev. | Achado | Onde | Por que ficou |
|---|---|---|---|
| ALTO | **Cron de billing estoura 60 s com ~100–150 pagantes.** A reconciliação reconsulta até 2×200 cobranças no MP, uma de cada vez; se passar do tempo, param em silêncio recálculo de status, lembretes, despesas recorrentes, limpezas e a importação de cotações. | `billing.service.ts` (`reconcilePendingPayments`), `api/cron/billing/route.ts` | Precisa de orçamento de tempo, concorrência limitada e rotação por cursor; merece medição real. **Próximo item a atacar.** |
| MÉDIO | QR PIX substituído só é cancelado no nosso banco; no MP segue pagável por 48 h. Pago com a linha em CANCELADO, só o webhook credita; se ele se perder, o cron não relê. Duplicatas e valor a menor ficam sem sinal para o admin. | `billing.service.ts` (cancelamentos locais, reconciliação) | Exige `PUT /v1/payments/{id}` no gateway e um estado "aprovado não creditado" — testar em sandbox. |
| MÉDIO | Sessão revogada (senha trocada, empresa bloqueada) cai em `global-error` sem saída por até 15 min. | `(app)/layout.tsx:20`, `(admin)/layout.tsx:16` | Trocar o `throw` por redirect a uma rota que limpa cookies; precisa de e2e. |
| MÉDIO | Lucro do mês no painel e "pagas no mês" em Despesas somam o `paidAmount` acumulado da higienização pela data do **último** pagamento (sobra do §29). | `dashboard.service.ts:243`, `despesas.service.ts:563` | Somar `crate_cleaning_payments` por `paidAt`; mexe em número exibido — validar com dado real. |
| MÉDIO | `sw.js` é fixo: `/consulta-offline` fica congelada na versão da instalação (a versão antiga quebra com `avisos[].total = null`); cache de `/_next/static` sem poda. | `public/sw.js` | Versionar o SW por build. |
| MÉDIO | Fiado "Pagas"/"Todas" sem `take`, em ordem crescente. | `fiado.service.ts:54` | Pede paginação na tela. |
| BAIXO | Excluir fiado cujas caixas já voltaram (`RETORNO` por nome de cliente, sem vínculo com a venda) deixa `comClientes` negativo. | `fiado.service.ts` `remove` | Precisa ligar o retorno à conta. |
| BAIXO | Lembrete "vence em 3 dias" não é atendível quando o vencimento cai no dia 1º (guarda por mês do calendário). | `prepareCharge` | Mesmo descompasso competência × período; ideal é a chave de aprovação virar o período. |
| BAIXO | Novo pagamento desfaz chargeback sozinho (`statusSource` volta a AUTO), contra o doc 05. | `applyPaymentStatus` | Decisão de produto. |
| BAIXO | Quem cancelou não troca de plano ao recontratar pela `/assinatura`. | `plano.service.ts:221` | Decisão de produto. |
| BAIXO | Regra 5 (auditoria/revogação na mesma transação) não vale em `reativarAssinatura`, `setTenantStatus`, `change-password` e `consumeResetToken` (revogação). | vários | Refatoração mecânica; baixo risco real. |
| BAIXO | Regra 2: `ratearFrete` não distribui o resíduo do arredondamento; `report.service.ts` calcula lucro inline. | `financial-calc.service.ts`, `report.service.ts` | Mexe em número de relatório. |
| BAIXO | Compra grava movimento de caixas sem o módulo `caixas`. | `compras.service.ts:146` | — |
| BAIXO | Callback do Google sem try/catch → 500 cru em falha de rede. | `api/auth/google/callback/route.ts` | — |
| BAIXO | Erro 401 do MP mostra ao cliente o nome da env `MERCADOPAGO_ACCESS_TOKEN`. | `mercadopago.ts` | Escolha deliberada (com teste), para diagnóstico do operador. |
| BAIXO | `addOneMonth` em UTC: pagamento às 22 h BRT dos dias 30/31 pode perder um dia. | `billing/status.ts:37` | — |

## 3. Verificado e limpo

- **Isolamento.**
  - Todo `tenantId` vem da sessão.
  - Todo `productId`, `supplierId`, `categoryId`, `accountId` e `packagingTypeId` vindo do body é conferido contra a empresa.
  - SQL cru é sempre parametrizado e filtra por tenant.
  - `TENANT_MODELS` bate com o schema, e o cleanup do factory está completo.
- **Proxy.**
  - `PUBLIC_PREFIXES` com fronteira, sem laço entre login, cadastro, alterar-senha, admin, suspensa e assinatura.
  - Toda Server Action e rota de negócio passa por wrapper com sessão, epoch, assinatura e módulo.
- **Auth.**
  - JWT HS256 fixado, com `iss`/`aud`/`typ`.
  - Cookies `httpOnly`/`Secure`/`SameSite=Lax`.
  - Refresh com rotação e família.
  - OAuth com PKCE S256 e `state` assinado.
  - Nenhum open redirect.
  - Tokens com hash SHA-256 e reset de uso único.
  - Zod em todas as entradas; o único `dangerouslySetInnerHTML` é JSON-LD estático.
- **Webhook MP.**
  - HMAC com `timingSafeEqual` e janela de ±300 s, sem bypass por ambiente.
  - Status sempre buscado na API.
  - Idempotência por transição condicional; saída de APROVADO só por reversão.
- **Fuso e datas.** Nenhum `setMonth`/`setHours`/`new Date(y,m,d)`, e `DATE_TRUNC` sempre com `AT TIME ZONE`.
- **Venda.** `FOR UPDATE` ordenado nos produtos, advisory lock nas caixas, idempotência por chave, auditoria dentro da transação.
- **SW.** Não guarda HTML nem API autenticada, e `force-dynamic` está em todas as páginas públicas.
