# 10. Evolução do PWA

O CeasaPro é usado em pé, no celular, no meio da operação do box — muitas vezes com
sinal ruim. Este documento define **até onde** o app vai funcionar sem rede, **por
que** o limite é esse, e o que medir para saber se a evolução deu resultado.

---

## A regra que governa tudo

> **Nenhuma escrita financeira acontece offline.** Venda, compra, pagamento de fiado,
> pagamento de higienização e ajuste de estoque só são gravados com o servidor
> respondendo.

Não é limitação técnica — é decisão de produto, e ela é o eixo de todo o resto.

**Por quê.** Toda operação financeira aqui depende de estado que o cliente não tem
como conhecer offline:

- **Venda** valida saldo de estoque no servidor e recusa vender acima do disponível.
  Uma venda aceita offline não teria como saber que outra pessoa já vendeu a última
  caixa. Ao sincronizar, ou o sistema aceita estoque negativo (mentindo sobre o que
  existe no box) ou recusa uma venda que o cliente já entregou e recebeu.
- **Compra** rateia o frete entre os itens e grava o custo real unitário. Duas compras
  sincronizadas fora de ordem produzem custos diferentes para a mesma mercadoria — e
  o custo é a base do lucro em todos os relatórios.
- **Pagamento de fiado** não pode passar do saldo devedor. Dois pagamentos offline do
  mesmo cliente podem, somados, exceder a dívida.
- **Ajuste de estoque** é append-only e auditado. Um ajuste com data de ontem
  chegando hoje reescreve a história do produto.

O padrão comum de PWA — fila de escritas com sincronização posterior — resolveria a
digitação, não o conflito. E o conflito aqui **não tem resolução automática correta**:
ninguém pode decidir por conta própria se a venda que o cliente já levou vale ou não.
Enfileirar criaria a expectativa de que "está salvo" quando não está, o que é pior que
avisar que falta conexão.

**O que isso não impede.** Consultar. Quem está no balcão sem sinal precisa saber
quanto tem em estoque, quem lhe deve e o que vence hoje — e nada disso exige escrita.
É esse o escopo da Fase 2.

---

## O que funciona offline

| Recurso | Offline | Observação |
|---|---|---|
| Abrir o app instalado | ✅ | App shell em cache (`sw.js`) |
| Consultar estoque, fiado em aberto, avisos e resumo do dia | ✅ (Fase 2) | Somente leitura, com a hora do último sincronismo visível |
| Navegar para telas não cacheadas | ⚠️ | Cai em `/consulta-offline` se houver dados; senão `/offline` |
| Registrar venda / compra / pagamento / ajuste | ❌ | Bloqueado na UI, com aviso |
| Emitir cobrança, pagar assinatura | ❌ | Depende do Mercado Pago |
| Exportar relatório | ❌ | Gerado no servidor |
| Receber avisos de fiado/despesa vencendo | ✅ (Fase 3) | Web Push; ver limites do iOS |

**Regra de ouro da tela offline:** todo dado exibido sem rede carrega a hora em que
foi buscado. Número sem data é pior que ausência de número — o cliente decide achando
que está olhando o agora.

---

## Limites do iOS (e por que a experiência difere)

O iOS é o caso que mais frustra expectativa, então vale ser explícito:

1. **Não existe instalação nativa.** O Safari não implementa
   `beforeinstallprompt`. O usuário precisa fazer **Compartilhar → Adicionar à Tela de
   Início** manualmente. Não há API para disparar isso, nem para detectar se ele fez.
   Daí o card com passo a passo em vez de botão.
2. **Só pelo Safari.** Chrome, Firefox e Edge no iOS usam o motor do Safari mas **não**
   oferecem "Adicionar à Tela de Início" com suporte a PWA. Se o usuário estiver em
   outro navegador, a instrução tem de mandá-lo abrir no Safari.
3. **Web Push exige o app na tela de início.** Desde o iOS 16.4 há Web Push, mas
   **somente** para PWA já adicionado à tela inicial — não funciona na aba do Safari.
   Ou seja: no iPhone, notificação depende de instalação, e instalação depende de ação
   manual. A Fase 3 precisa dizer isso ao usuário em vez de só pedir permissão.
4. **Cache pode ser descartado.** O Safari limpa dados de sites não usados por ~7 dias.
   Um snapshot offline pode simplesmente não estar lá. A tela precisa tratar "sem
   dados" como estado normal, não como erro.
5. **Sem Background Sync.** A API não existe no iOS. Qualquer sincronização acontece
   com o app aberto — o que reforça a decisão de não enfileirar escritas.

No Android/Chrome e no desktop (Chrome/Edge) a instalação é nativa via
`beforeinstallprompt`, e o Web Push funciona na aba, sem exigir instalação.

---

## Fases

### Fase 1 — Instalação guiada
Levar o usuário a instalar o app logo após o login, porque o ganho de velocidade no
balcão só existe se o app estiver na tela inicial. Prompt automático uma vez, respeitando
"Agora não" por 7 dias, e reabrível em Configurações.

### Fase 2 — Consulta offline (somente leitura) — **implementada**

| Peça | Onde |
|---|---|
| Snapshot da empresa | `GET /api/pwa/snapshot` (`withTenantRoute`) |
| Armazenamento | `src/lib/pwa/offline-store.ts` (IndexedDB, um registro) |
| Sincronismo | `OfflineSync` montado no Início, debounce de 5 min |
| Tela | `/consulta-offline` (cliente; lê do IndexedDB) |
| Faixa de rede | `NetworkStatus` no `AppShell` |
| Bloqueio de escrita | `api-client.ts` recusa POST offline com código `OFFLINE` |
| Fallback de navegação | `sw.js`: /consulta-offline se houver snapshot, senão /offline |

Decisões que valem registro:

- **Números viram `number` na borda da API.** `Prisma.Decimal` não sobrevive a JSON
  de forma útil, e a tela offline só exibe — os totais vêm somados do servidor. Nada
  é recalculado no cliente.
- **Listas limitadas** (200 produtos, 100 contas). O snapshot vai para o
  armazenamento do celular, que o Safari descarta quando o site fica sem uso; payload
  grande aumenta o custo e a chance de ser jogado fora.
- **Tudo no `offline-store` falha em silêncio.** Aba privada, cota esgotada e
  armazenamento bloqueado por política são cenários NORMAIS. Quem chama trata `null`
  como "não tenho dados", que é um estado previsto da tela — não um erro.
- **`/consulta-offline` é rota pública no proxy.** Sem rede o access token pode ter
  expirado, e redirecionar para /login tiraria do usuário justamente o dado que já
  está no aparelho dele. O que protege esses dados é o logout apagá-los.
- **O logout apaga o snapshot** (`limparSnapshotNoLogout`). É privacidade, não
  limpeza: o snapshot tem estoque, nomes de clientes e quanto cada um deve, e a tela
  lê do IndexedDB sem pedir sessão. Em celular compartilhado, deixá-lo entregaria o
  movimento da empresa para o próximo que abrisse o app.
- **`navigator.onLine` não é verdade absoluta.** Ele afirma que existe interface de
  rede, não que a internet funciona (Wi-Fi de portal cativo aparece como online). Por
  isso ele serve para avisar e recusar cedo, mas quem decide é a requisição falhando.

### Fase 3 — Web Push — **implementada**

Avisos que antes só apareciam se o usuário abrisse o app (fiado vencido, despesa a
vencer, higienização a pagar) passam a chegar como notificação, com o app fechado.

| Peça | Onde |
|---|---|
| Tabela de inscrições | `PushSubscription` (`endpoint` único = o aparelho) |
| Envio | `src/lib/pwa/push-server.ts` (VAPID, remove inscrição morta) |
| Inscrição/cancelamento | `PushInscricaoService` + `POST|DELETE /api/pwa/push` |
| Validação da entrada | `src/lib/validations/push.ts` (endpoint https, tetos) |
| Opt-in na tela | `src/components/pwa/push-opt-in.tsx` (em Configurações) |
| Recebimento e clique | `sw.js`: `push`, `notificationclick`, `pushsubscriptionchange` |
| Regra de quem recebe | `PushAvisosService` (`src/lib/services/push-avisos.service.ts`) |
| Disparo diário | `GET|POST /api/cron/avisos`, agendado em `vercel.json` (06:30 BRT) |

Decisões que valem registro:

- **O opt-in é separado do convite de instalação, e fica em Configurações.** São dois
  pedidos: quem hesita em instalar recusa o pacote inteiro. E a permissão de
  notificação, uma vez **negada, não pode ser pedida de novo** — só nas configurações
  do navegador, onde ninguém vai. Gastar esse tiro num momento ruim é definitivo.
- **No iPhone, o botão não é oferecido fora do app instalado.** O Web Push do iOS só
  funciona com o app na tela de início (16.4+); pedir a permissão numa aba do Safari
  falharia e queimaria a permissão. A tela explica o pré-requisito em vez disso.
- **Uma notificação por empresa por dia, não uma por aviso.** Três notificações
  simultâneas sobre a mesma operação treinam o usuário a descartar sem ler — e aí ele
  perde a que importava. O resumo vai no corpo, e a `tag` fixa faz o aviso de hoje
  **substituir** o de ontem na bandeja em vez de empilhar.
- **Dedupe pelo log de auditoria, janela de 20h.** O cron pode ser reexecutado (retry
  da plataforma, disparo manual). 20h e não 24h de propósito: um atraso na plataforma
  faria a execução do dia seguinte cair dentro de uma janela de 24h e silenciar o aviso
  daquele dia. A marca só é gravada **se algo saiu** — falha do serviço de push não pode
  silenciar o aviso de amanhã.
- **Empresa com acesso bloqueado não recebe.** Avisar "você tem fiado vencido" a quem
  não consegue abrir a tela de fiado é ruído com dano: a pessoa toca na notificação e
  cai no bloqueio de assinatura.
- **404/410 do serviço de push apaga a inscrição.** Não é erro nosso: é o serviço
  dizendo que o destino não existe mais (app desinstalado, dados do site limpos). Sem
  apagar, o cron marteleria um endereço morto todos os dias, para sempre.
- **`endpoint` é a identidade do aparelho, e o registro é `upsert`.** O navegador
  devolve a MESMA inscrição quando o opt-in é reaberto; um `create` faria a pessoa
  receber cada aviso em duplicado. O upsert também **reatribui** o dono: em celular
  compartilhado, a inscrição passa a quem está logado agora — senão o aparelho
  continuaria recebendo os números da empresa anterior.
- **O endpoint precisa ser https, com teto de tamanho.** O cron faz uma requisição
  *para* esse endereço; aceitar `http://` ou um endereço arbitrário transformaria o
  cron em cliente de destino escolhido pelo cliente (SSRF).
- **Nenhum endpoint vai para o log** — só o host. Com as chaves, o endpoint permite
  enviar notificação para aquele aparelho: é credencial.
- **Sem chaves VAPID, o envio é no-op registrado no log.** Mesmo desenho do SMTP:
  permite rodar em desenvolvimento sem serviço externo.
- **A notificação não carrega valores em dinheiro.** Ela aparece na tela de bloqueio
  do celular, visível para quem estiver por perto; o texto diz o que precisa de
  atenção ("3 despesa(s) vencida(s)") e o valor fica atrás do login.

---

## Métricas

Sem medição não há como saber se a evolução funcionou. O que acompanhar:

**Fase 1 — instalação**
- Taxa de instalação: instalações ÷ prompts exibidos, separada por plataforma
  (Android e iOS têm fluxos incomparáveis; média junta esconde os dois).
- Taxa de "Agora não" e quantos voltam a ver o prompt depois de 7 dias.
- Proporção de sessões em `display-mode: standalone` — é o número que realmente
  importa: mede uso instalado, não intenção declarada.

**Fase 2 — offline**
- Aberturas de `/consulta-offline` (quantas vezes a rede faltou de verdade).
- Idade do snapshot no momento do uso: se a mediana for de horas, o sincronismo está
  raro demais para ser útil.
- Tentativas de escrita bloqueadas por falta de conexão — se for alto, é sinal de que
  a decisão de não enfileirar está custando ao usuário, e o assunto merece revisão
  com dados em vez de opinião.

**Fase 3 — push**
- Aceitação da permissão, separada por plataforma.
- Cliques por notificação enviada e cancelamentos de inscrição. Notificação ignorada
  treina o usuário a ignorar as próximas; frequência alta com clique baixo é motivo
  para reduzir envio, não para aumentar.

---

## Notas de operação

- **Instalação exige HTTPS.** Em `http://` (exceto `localhost`) o navegador não
  oferece instalação nem registra service worker.
- **O service worker só é registrado em produção** (`pwa-register.tsx`). Em
  desenvolvimento ele é ativamente **desregistrado** e os caches limpos — um SW antigo
  servindo chunks de JS de um build anterior quebra o app no dev de um jeito difícil
  de diagnosticar. Consequência prática: **o fluxo de instalação e o offline não são
  testáveis com `npm run dev`**; use `npm run build && npm start` sobre HTTPS, ou o
  ambiente de produção.
- **As chaves VAPID têm de ser estáveis.** Trocar o par invalida TODAS as inscrições
  existentes, e os usuários param de receber sem nenhum aviso — eles continuariam
  aparecendo como inscritos no próprio aparelho. Gere uma vez
  (`npx web-push generate-vapid-keys`) e guarde.
- **`NEXT_PUBLIC_VAPID_PUBLIC_KEY` é embutida no bundle no BUILD.** Alterar a variável
  e reiniciar não tem efeito: exige rebuild.
- **O precache das páginas de fallback inclui os assets delas.** O `sw.js` busca o
  HTML de /offline e /consulta-offline no install e cacheia o que eles referenciam em
  /_next/static (os nomes levam hash do build, então não há lista a manter). Guardar
  só o HTML deixava a página abrir offline e travar em "Carregando…".
- **Ao trocar a versão do cache no `sw.js`**, o SW antigo continua ativo até todas as
  abas fecharem. `skipWaiting` + `clients.claim` (já usados) encurtam isso, mas não
  eliminam a janela.

---

## Checklist manual — Fase 1

O que a automação **não** alcança: `beforeinstallprompt` não dispara em Chromium
headless (o navegador só o emite quando considera o site instalável, o que exige
HTTPS + manifest + service worker ativos), e no iOS não existe API nenhuma para a
instalação. `tests/e2e/pwa-install.spec.ts` cobre as REGRAS de exibição; a
instalação em si tem de ser conferida à mão, em **produção sobre HTTPS**.

### Android (Chrome)
- [ ] Login → o painel abre na primeira tela, com o botão **Instalar agora**.
- [ ] "Instalar agora" abre a caixa nativa do Chrome e instala.
- [ ] O ícone aparece na gaveta de apps; abrir por ele não mostra a barra do navegador.
- [ ] Abrindo pelo ícone, o painel **não** reaparece.
- [ ] "Agora não" → não reaparece em novos logins por 7 dias.
- [ ] Configurações → "Instalar app / atalho na tela inicial" reabre o painel.

### iPhone (Safari)
- [ ] Login → o painel abre já com o passo a passo (sem botão de instalar).
- [ ] Seguir Compartilhar → Adicionar à Tela de Início cria o ícone.
- [ ] Abrindo pelo ícone, o painel **não** reaparece.
- [ ] Em Chrome/Firefox no iPhone o painel **não** abre (não há caminho ali).

### Desktop (Chrome/Edge)
- [ ] Login → painel com **Instalar agora**; instala como janela própria.
- [ ] Em navegador sem suporte (ex.: Firefox), o painel explica em vez de oferecer
      um botão que não funcionaria.

### Pré-requisitos do teste
- **HTTPS obrigatório.** Em `http://` (exceto `localhost`) o navegador não oferece
  instalação nem registra service worker.
- **Só em produção.** `pwa-register.tsx` registra o SW apenas quando
  `NODE_ENV === "production"`; em desenvolvimento ele DESREGISTRA e limpa caches.
  Use `npm run build && npm start` sobre HTTPS, ou o ambiente publicado.

### Nota de UX registrada
O painel é **modal**: enquanto está aberto, o resto da tela fica inerte. Foi assim
que se pediu (e é o padrão que converte), mas o custo é interceptar a primeira ação
do usuário depois do login. Se a taxa de "Agora não" vier alta, o caminho é trocar
por uma faixa não-modal no topo — a decisão deve sair da métrica, não de opinião.

---

## Checklist manual — Fase 2

Automatizado em `tests/e2e/pwa-offline.spec.ts` (snapshot gravado, tela com a hora de
origem, **navegação offline nos dois ramos** — /consulta-offline com dados salvos e
/offline sem eles — e logout apagando) e `tests/unit/api-client-offline.test.ts`
(escrita recusada antes de chamar `fetch`).

O service worker entra no teste: `http://localhost` é contexto seguro, então o build
de produção que o Playwright sobe registra o SW e ele assume o controle. Foi assim que
apareceu o defeito corrigido na **v6** do `sw.js`: o precache guardava o HTML das
páginas de fallback mas não os chunks de JS que elas carregam, então offline a tela de
consulta abria e ficava presa em "Carregando…" — com os dados no aparelho e sem
conseguir mostrá-los.

**O que a automação não alcança:** a instalação nativa (abrir pelo ícone da tela
inicial), que depende do navegador considerar o site instalável.

- [ ] Abrir o Início com internet, fechar o app e ativar o modo avião.
- [ ] Abrir o app pelo ícone: deve cair em **/consulta-offline** com os dados salvos
      e a hora de origem, não na tela genérica de "sem conexão".
- [ ] Limpar os dados do site (ou usar aparelho novo) e repetir sem nunca ter aberto o
      Início: agora deve cair em **/offline**, porque não há snapshot.
- [ ] Offline, tentar finalizar uma venda no PDV: a mensagem tem de afirmar que
      **nada foi registrado**.
- [ ] Voltar a ter rede e conferir que o Início traz números atualizados.
- [ ] Sair (logout) e abrir /consulta-offline: deve dizer que não há dados salvos.
- [ ] Trocar a versão do cache do `sw.js` exige fechar todas as abas para o SW novo
      assumir; conferir que a v6 está ativa em DevTools › Application › Service Workers.

---

## Checklist manual — Fase 3

Automatizado em `tests/integration/push-inscricao.test.ts` (dono da inscrição,
upsert por endpoint), `tests/integration/push-avisos.test.ts` (uma por empresa,
dedupe, bloqueado não recebe, falha não marca), `tests/unit/push-validations.test.ts`
(https e tetos) e `tests/e2e/pwa-push.spec.ts` (rota sob sessão + qual botão cada
plataforma vê).

Os dois testes de TELA exigem `NEXT_PUBLIC_VAPID_PUBLIC_KEY` definida **no build**
(ela é substituída pelo valor literal ali). Sem a chave o opt-in não se anuncia, e não
há o que verificar — foi assim que esses testes quebraram no CI antes de a variável
entrar no `env` do job em `.github/workflows/ci.yml`. Só a metade PÚBLICA está lá: o
CI renderiza a tela e fica incapaz de enviar notificação.

**O que a automação não alcança:** a notificação chegando. Isso exige uma inscrição
real num serviço de push (FCM, Mozilla, Apple), que o Chromium headless não obtém, e o
aparelho recebendo com o app fechado — que é justamente o cenário do recurso.

### Pré-requisitos

- [ ] `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` definidas
      **antes do build** (a pública entra no bundle).
- [ ] HTTPS e `NODE_ENV=production` — sem service worker não há push.
- [ ] Uma empresa com pelo menos um aviso de verdade (despesa vencida, fiado vencido
      ou higienização a pagar); sem aviso, o cron corretamente não envia nada.

### Android (Chrome)

- [ ] Instalar o app pela tela inicial, abrir **Configurações › Aplicativo e avisos**
      e tocar em **Ativar avisos neste aparelho**; aceitar a permissão do sistema.
- [ ] Conferir no banco que existe **uma** linha em `push_subscriptions` para o
      usuário — e que reabrir Configurações e tocar de novo **não** cria a segunda.
- [ ] Disparar o cron à mão
      (`curl -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/avisos`)
      com o app **fechado**: a notificação tem de aparecer na bandeja.
- [ ] Disparar **de novo em seguida**: nada deve chegar (dedupe de 20h).
- [ ] Tocar na notificação: abre o app na tela do aviso (fiado/despesa/higienização),
      e com o app já aberto **reaproveita a janela** em vez de abrir outra.
- [ ] Conferir que o texto **não** mostra valor em dinheiro (aparece na tela de bloqueio).
- [ ] Tocar em **Desativar avisos neste aparelho** e conferir que a linha saiu do banco.
- [ ] Desinstalar o app sem desativar antes, disparar o cron e conferir que a inscrição
      é **removida sozinha** (404/410 do FCM).

### iPhone (Safari, iOS 16.4+)

- [ ] Numa **aba** do Safari, ir em Configurações: deve aparecer o aviso de que os
      avisos exigem o app na tela de início — e **nenhum** botão de ativar.
- [ ] Adicionar à Tela de Início, abrir **pelo ícone** e ativar os avisos ali.
- [ ] Disparar o cron com o app fechado e conferir a notificação.
- [ ] Reiniciar o aparelho e repetir: o iOS descarta inscrição de app pouco usado, e é
      bom saber se isso acontece nesta versão.

### Desktop (Chrome/Edge)

- [ ] Ativar os avisos, fechar **todas** as janelas do app e disparar o cron: a
      notificação aparece pelo sistema operacional.
- [ ] Com o Windows em **Assistente de foco**, conferir que ela fica no histórico —
      não é falha do app.

### Empresa bloqueada

- [ ] Suspender a assinatura de uma empresa inscrita, disparar o cron e conferir que
      ela **não** recebe nada (e que as outras continuam recebendo).
