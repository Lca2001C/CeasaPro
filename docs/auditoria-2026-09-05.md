# Auditoria ponta a ponta — 2026-09-05

Varredura completa, sem exclusões, atrás de bugs e vulnerabilidades, com
correção e teste de regressão para cada achado.

A auditoria anterior (`auditoria-producao-2026-09-03.md`) deixou o **PDV** fora
de escopo e registrou isso como risco residual nº 1. É de lá que vêm os dois
achados críticos desta rodada.

Régua combinada: **tudo** — bug, vulnerabilidade, endurecimento, refactor e
performance.

---

## Resumo

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| 1 | Troco calculado contra o total, não contra a parcela em dinheiro | **Crítica** | Corrigido |
| 2 | Nenhuma idempotência no `POST /api/vendas` — retentativa duplicava a venda | **Crítica** | Corrigido |
| 3 | Estoque ia a negativo em vendas simultâneas | Alta | Corrigido |
| 4 | Saldo de caixas lido fora da transação, em 7 lugares (TOCTOU) | Alta | Corrigido |
| 5 | Cancelamento de venda sem guarda otimista — estoque creditado 2× | Alta | Corrigido |
| 6 | `plasticCrateQty: 0` apagava as caixas declaradas por item | Alta | Corrigido |
| 7 | Data escolhida no formulário gravada no dia anterior | Alta | Corrigido |
| 8 | Custo médio era média aritmética, não ponderada | Alta | Corrigido |
| 9 | Soft delete × índice único derrubava o recadastro (P2002) | Alta | Corrigido |
| 10 | Ajuste de estoque sem validação de saldo | Alta | Corrigido |
| 11 | Reuso de refresh token não detectado | Alta | Corrigido |
| 12 | Revogação de sessão só valia depois de até 15 min | Média-Alta | Corrigido |
| 13 | `matcher` do proxy soltava caminhos com `.png` do middleware | Média | Corrigido |
| 14 | State do OAuth aceito como access token | Média | Corrigido |
| 15 | Módulos do plano em fail-open | Média | Corrigido |
| 16 | Gate de assinatura e módulo só no middleware | Média | Corrigido |
| 17 | `x-real-ip` confiado sem allowlist | Média | Corrigido |
| 18 | Rate limit de autenticação em fail-open | Média-Baixa | Corrigido |
| 19 | Três algoritmos de arredondamento para o mesmo total | Média | Corrigido |
| 20 | Relatório de higienização ignorava caixas perdidas | Média | Corrigido |
| 21 | Relatório de inadimplentes: `NULL`, período e fuso | Média | Corrigido |
| 22 | Agregações do mês no painel sem teto | Média | Corrigido |
| 23 | Valor de estoque divergia entre painel e tela | Média | Corrigido |
| 24 | `Sec-Fetch-Mode` em fail-open | Baixa | Corrigido |
| 25 | Dois contratos de redirect seguro | Baixa | Corrigido |
| 26 | Reduzir envio de higienização "lavava" caixas | Baixa | Corrigido |
| 27 | Contas a pagar contava lote já quitado | Baixa | Corrigido |
| 28 | Paginação sem clamp respondia 500 | Baixa | Corrigido |
| 29 | Cron gerava recorrente para empresa excluída | Baixa | Corrigido |
| 30 | Item fantasma de 0,001 no botão "−" | Média | Corrigido |
| 31 | `amountReceived` sem teto; caixa sem cliente presa | Média | Corrigido |
| 32 | Rascunhos `tmo-*` versionados na raiz | Baixa | Corrigido |
| 33 | Troca de plano sem cobrança nem proporcional | — | **Fora de escopo, por decisão** |

Baseline e regressão final: `lint --max-warnings=0`, `typecheck`, 520 unitários,
405 de integração, `build` e 98 E2E — tudo verde.

---

## O que a baseline revelou antes de qualquer correção

**O gate do CI estava vermelho em `main`.** `npm run lint -- --max-warnings=0`
falhava por um aviso em `cancelar-assinatura.tsx`: `window.location.assign()`
com destino literal. O projeto já tinha `irComSessaoNova()` em `session-nav.ts`
criado exatamente para isso, com o comentário pedindo que "qualquer chamada nova
de recarga passe por aqui e justifique o motivo". Este ponto não passou.

**Duas coisas que reportei erradas no plano e corrijo aqui:**

- O repositório **tem 90 commits**. O repo vazio que inspecionei era a pasta-mãe
  `Nova pasta`; o projeto é um repositório próprio.
- As 2 falhas de `pwa-push.spec.ts` que atribuí ao código eram do **ambiente
  local**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` vazia no `.env`, e ela é substituída em
  tempo de **build**. Com a chave pública do CI e um rebuild, passam.

---

## Os dois críticos

### 1. Troco em pagamento misto

`amountReceived` é o dinheiro entregue pela parte paga **em espécie**, e o
serviço comparava com o total da venda.

Venda de R$ 50 com R$ 30 em PIX e R$ 20 em dinheiro; o cliente entrega uma nota
de R$ 50. Troco correto: R$ 30. O sistema gravava **R$ 0,00** — e o PDV ainda
BLOQUEAVA a venda antes disso ("O valor recebido é menor que o total"),
empurrando o operador a digitar 100 para conseguir vender, o que registrava
`amountReceived = 100` numa venda com R$ 20 em espécie. A conferência de gaveta
não fechava nunca.

Nenhum teste cobria: os de troco usavam só `paymentMethod: "DINHEIRO"` puro, e
os de pagamento misto não tocavam em troco. O defeito vivia na interseção.

### 2. Venda duplicada por retentativa

O `POST /api/vendas` não tinha chave de idempotência, dedup nem constraint. E
três coisas conspiravam para o operador repetir: `apiPost` sem timeout, a
mensagem "Falha de conexão. **Tente novamente**", e o carrinho não sendo limpo
no erro.

Com a rede oscilando, o pedido chegava, a transação commitava e só a resposta se
perdia. O segundo toque registrava tudo de novo: estoque baixado em dobro,
segunda conta de fiado no mesmo nome, duas saídas de caixa plástica.

A chave é gerada pelo **cliente**, uma por carrinho. Não pode ser derivada do
conteúdo: no balcão, duas vendas idênticas em sequência são corriqueiras, e
deduplicar por hash recusaria dinheiro real.

---

## Decisões de projeto que valem registro

**Bloqueio de estoque: `FOR UPDATE` na linha de `products`.** `stock_movements` é
ledger só-de-inserção — não existe linha de saldo para travar, e travar as
movimentações existentes não impede a inserção concorrente. Travar a linha pai é
o padrão para invariante derivada de ledger. `ORDER BY id` é obrigatório (senão
dois carrinhos com os mesmos produtos em ordens diferentes dão deadlock), e
READ COMMITTED é *load-bearing*: sob REPEATABLE READ o lock seria inútil, porque
a leitura seguinte não veria o commit anterior.

**Saldo de caixas: advisory lock de transação.** Os quatro potes são um pool
único por empresa; a granularidade da invariante é a empresa. `pg_advisory_xact_lock`
é liberado no commit, dentro da mesma conexão, e por isso sobrevive ao pgbouncer
em modo *transaction* do Neon — o de sessão não sobreviveria. Vai por
`$executeRaw`: a função devolve `void`, que o `$queryRaw` do Prisma não
desserializa.

**Detecção de reuso de refresh token com janela de graça.** Três produtores
renovam concorrentemente e nenhum enxerga o outro, e há o caso que trava nenhuma
cobre: a resposta se perde depois de o servidor já ter rotacionado. Um token
recém-rotacionado segue aceito por 30 s e no máximo 3 vezes. `revokedAt` nunca é
reescrito nesse caminho (senão o atacante manteria a janela escorregando), token
desconhecido não revoga nada (fecha o DoS de terceiro), revoga-se a **família**
e não a conta, e a resposta a "reuso" é idêntica à de "inválido".

**Revogação: `sessionEpoch` no token, conferido nos wrappers.** O incremento mora
dentro de `revokeAllForUser`/`revokeAllForTenant` — e é esse o ponto: os oito
call sites já chamavam uma das duas. Espalhar o incremento garantiria que um
ficasse de fora. Não no proxy (Edge, sem banco) nem em `getSession()` (taxaria
todo render de RSC).

**Chaves de JWT separadas por HKDF.** Sem variável de ambiente nova e sem
migration, com `iss`/`aud`/`typ` — três barreiras independentes contra confusão
de tipo de token.

**Custo médio: histórico NÃO reescrito.** `unitCostAtSale` é snapshot.
Reescrever silenciosamente o passado é pior que o degrau no relatório; o
recálculo é decisão do dono e merece script próprio.

**Soft delete: ressuscitar, não carimbar.** Diverge do precedente do projeto
(`users.email` ganha prefixo `excluido-`) porque nome de categoria é rótulo que o
usuário lê, e a exclusão só é permitida quando a categoria não está em uso.

---

## Dois erros meus, corrigidos por medição

**Arredondamento.** A primeira versão do módulo de totais arredondava os preços
**antes** de multiplicar. Em `7 × 0,105` isso dá R$ 0,77; o `Prisma.Decimal`
multiplica em precisão cheia (0,735) e arredonda uma vez, dando R$ 0,74 — que é o
que está no banco. O teste comparando contra uma implementação de referência em
`Decimal` pegou.

**`Sec-Fetch`.** Escrevi a checagem exigindo também `dest: document`, o que
parecia mais estrito, e **quebrou** dois E2E de renovação por navegação.
Instrumentei a rota para ver o que realmente chega: quando o proxy desvia uma
navegação, o Chromium manda `{mode: "navigate", dest: "empty"}` — o `dest` de
documento não sobrevive ao salto do redirecionamento. O caso medido virou teste.

---

## Verificado e correto — não re-auditar

- **Isolamento multi-tenant.** `getTenantPrisma` injeta `where.tenantId` e
  `deletedAt: null`, remove `tenantId` de `data` em update/upsert, e
  `models-tenant-cobertura.test.ts` lê o schema e reprova o CI se um modelo
  escapar. Nenhum `findUnique({where:{id}})` em modelo de tenant; nenhum IDOR nas
  rotas `[id]`; `createManyAndReturn`/`updateManyAndReturn` não são usados.
- **SQL injection: nada.** As 30 `$queryRaw` são template tags parametrizadas; o
  único `Prisma.raw` usa constante de compilação e nomes de coluna fixos.
- **Mass assignment: nada** — zero `data: input`, zero `z.any()`,
  `.passthrough()` ou `z.coerce`.
- **Reset de senha e Google OAuth** estão corretos ponta a ponta: token de 32
  bytes só em hash, uso único garantido no banco, sem enumeração de usuário,
  resposta de tempo constante no login (Argon2id com hash de isca), PKCE S256
  real, `state` conferido, `email_verified` exigido.
- **Webhook do Mercado Pago**: HMAC com `timingSafeEqual`, janela anti-replay, e
  processa **o `data.id` que fechou o HMAC** — não o do corpo. Idempotência real
  por `updateMany` + conferência de `count`.
- **Fuso**: `tz.ts` trata DST com dupla passagem de offset; o SQL de agrupamento
  converte antes de truncar.
- **PWA**: não existe fila de escrita offline, por decisão de produto — o que
  elimina de saída toda a classe "fila reenvia e duplica ao voltar online".
- **Injeção de fórmula em planilha** tratada em toda célula; `type` do relatório
  validado contra allowlist.

### Refutados na verificação

- Modelos com `tenantId` fora de `TENANT_MODELS` — a lista está completa e
  travada por teste.
- Server Action escapando do gate de assinatura — `withTenantAction` chama
  `assertActive`.
- Plano interno do super-admin contratável por cliente — nasce `active: false`.
- Bypass do `matcher` dando acesso a dado de outra empresa — os layouts e
  wrappers refazem a checagem de sessão. O que se perdia de fato era CSP e os
  gates de plano/assinatura, corrigidos nos itens 13 e 16.

---

## Mudanças visíveis, para o deploy

1. **Todos os access tokens em circulação param de valer.** A chave de assinatura
   passou a ser derivada por HKDF. É transparente para quem tem refresh token
   (opaco, não depende da chave) — a renovação é automática. Quem estiver no meio
   de um login com Google, na janela de 10 min, recebe "Não foi possível entrar
   com o Google" e clica de novo.
2. **Revogação passa a valer na hora.** Desativar usuário, bloquear empresa,
   excluir, chargeback e troca de senha derrubam a sessão imediatamente. O
   suporte precisa saber que "eu desativei e ele continuou usando" acabou.
3. **Números que mudam na tela** — e os novos são os certos: custo médio e lucro,
   valor de estoque no painel, a receber de higienização, inadimplentes, lucro do
   mês e contas a pagar.
4. **Rate limit fail-closed**: se o Postgres piscar, o login responde 503 com
   mensagem de indisponibilidade em vez de deixar passar.
5. **`AJUSTE` de estoque aceita quantidade negativa** — é o acerto de inventário
   para baixo, que não existia.

Duas migrations novas: `20260905120000_venda_idempotencia` e
`20260905130000_sessao_revogacao_e_reuso`. Nenhuma variável de ambiente nova.

---

## Fora de escopo, por decisão

**Troca de plano sem cobrança nem proporcional.** Subir de plano no dia 2, usar o
mês inteiro e descer no dia 28 pagando o valor menor é repetível todo mês. O
JSDoc de `changePlan` assume a ausência de proporcional ("não há proporcional
nesta versão"), então é limitação declarada de produto, não defeito — e mudá-la é
decisão de negócio. Fica registrado.

## Riscos residuais

1. **`unitCostAtSale` histórico** segue com o custo aritmético. Relatórios de
   lucro sobre períodos antigos mantêm o valor antigo; o degrau aparece na data
   desta correção.
2. **Janela de leitura de página** continua limitada ao TTL do access token:
   navegação client-side entre telas do mesmo grupo, sem chamada de API e sem
   escrita, não revalida. Nesse intervalo a pessoa só vê o que já estava
   renderizado.
3. **`form-action 'self' https:`** no CSP continua frouxo por causa do desafio
   3-D Secure, que abre para o domínio do banco emissor. Restringi-lo só à rota
   de checkout ficou de fora desta rodada.
4. **Sem `report-uri`/`report-to`** no CSP, então `CSP_REPORT_ONLY=1` publica a
   política sem coletar nada.
5. **Comportamento sob pgbouncer** (advisory lock, `$transaction` interativa) foi
   verificado por leitura e pelo build, não por execução: os testes de integração
   rodam contra Postgres local, e `guard-database.ts` recusa banco não-local.
6. **CVEs transitivos** do item 5 da auditoria anterior seguem abertos, com o
   raciocínio de exposição já registrado lá.
