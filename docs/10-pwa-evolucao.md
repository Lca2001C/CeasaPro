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
| Fallback de navegação | `sw.js` v4: /consulta-offline se houver snapshot, senão /offline |

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

### Fase 3 — Web Push
Avisos que hoje só aparecem se o usuário abrir o app (fiado vencido, despesa a vencer,
higienização a pagar) passam a chegar como notificação. Opt-in explícito e separado do
prompt de instalação — juntar os dois pedidos derruba a aceitação dos dois.

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
origem, logout apagando) e `tests/unit/api-client-offline.test.ts` (escrita recusada
antes de chamar `fetch`).

**O que a automação não alcança:** o service worker. Ele só é registrado com
`NODE_ENV=production` e HTTPS, então no `npm start` do Playwright (HTTP em localhost)
o SW não assume o controle — e sem ele o navegador mostra a própria tela de erro em
vez de servir `/consulta-offline`. A navegação offline precisa ser conferida à mão.

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
      assumir; conferir que a v4 está ativa em DevTools › Application › Service Workers.
