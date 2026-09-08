# Auditoria — 2026-09-07

Auditoria do módulo **Cotações** (recém-escrito, incluindo a importação
automática) e varredura do restante do código atrás de defeitos. Complementa a
auditoria de ponta a ponta de 2026-09-05, cujos achados não são repetidos aqui.

**Oito defeitos corrigidos.** Dois deles derrubariam o módulo em produção sem
aparecer nos testes; um alcança sete serviços que não têm nada a ver com
cotações. Cada correção tem teste que REPROVA no código anterior — verificado
desfazendo a correção e rodando.

---

## Resumo

| # | Onde | Defeito | Como se manifestava |
|---|---|---|---|
| 1 | `cotacoes-import.service.ts` | Gravação linha a linha (3 idas ao banco × 215 linhas) | Cron estourava o tempo da função serverless e morria pela metade, todo dia, sem erro |
| 2 | `cotacoes-import.service.ts` | "Procura, não achou, cria" no catálogo | Duas execuções simultâneas do cron estouravam violação de chave única |
| 3 | `tz.ts` (`parseIsoDateTz`) | Validava o FORMATO, não a data | `2026-13-45` virava 14/02/2027 em silêncio — em 7 serviços |
| 4 | `cotacoes.service.ts` | Tela de vínculo oferecia o catálogo global | Vínculo a produto de outra central nunca mostrava preço, sem explicação |
| 5 | `frescor.ts` + importador | Dia lido em UTC, não no fuso do app | Depois das 21h o boletim de hoje contava como de ontem |
| 6 | `ceasaminas.ts` | `script_case_init` fixo | Token de sessão do ScriptCase varia; dependia de comportamento não documentado |
| 7 | `ceasaminas.ts` | `this.parse` dentro de `buscar` | Desestruturar a fonte quebrava o parser só em produção |
| 8 | `configuracoes/page.tsx` | Central do CEASA na aba "Meu perfil" | Dado da empresa na aba da pessoa |

Mais três defeitos **na própria suíte de testes**, que a faziam mentir:

| # | Onde | Defeito |
|---|---|---|
| 9 | `admin-workspace.test.ts` | Teardown apagava plano COMPARTILHADO → derrubava o arquivo por FK, com os 4 testes passando |
| 10 | `sessao-expirada.spec.ts` | Afirmava `localhost:3000` literal → teste de segurança falhava por causa da porta |
| 11 | `pwa-push.spec.ts` | Mesma porta fixa na criação do contexto anônimo |

---

## Os dois que matariam o módulo em produção

### 1. O cron estouraria o tempo — medido, não suposto

`gravar()` fazia três idas ao banco por linha do boletim. Medição contra o
boletim real de 04/09 (215 linhas), com **Postgres em localhost**:

```
215 linhas -> 1626 ms  (7,6 ms/linha)
extrapolando 7 centrais: 11,4 s só de banco, local
```

Em produção o banco é o Neon, com rede e pgbouncer no caminho — tipicamente uma
ordem de grandeza mais lento por ida. Some duas requisições HTTP por central
contra um PHP legado. A função serverless da Vercel corta em **10 s** no plano
Hobby, e **não havia `maxDuration` em lugar nenhum do projeto**.

O desfecho não seria um erro: seria a importação morrendo no meio, todo dia,
deixando algumas centrais atualizadas e outras não — exatamente o tipo de falha
silenciosa que o resto do módulo foi desenhado para evitar.

Correções:

- **Gravação em lote**: `createMany` + um único `INSERT ... ON CONFLICT` para o
  boletim inteiro. As ~645 idas viraram meia dúzia. Medido: **1626 ms → 140 ms**,
  11,6× mais rápido.
- **`maxDuration = 60`** na rota do cron (teto do plano Hobby).
- **Orçamento de tempo próprio** (40 s) no serviço: ele para sozinho antes de a
  plataforma matá-lo. Ser morto no meio de uma gravação deixa a central pela
  metade e sem registro; parar por conta própria é "não deu tempo hoje, amanhã
  pega".
- **Ordem por quem está mais atrasado**, não por `sortOrder`. Com ordem fixa e
  orçamento, as últimas centrais nunca seriam importadas — passariam fome todo
  dia e disparariam o alarme de defasagem para sempre, sem nada quebrado.

### 2. Corrida no catálogo de produtos

A versão anterior fazia `findUnique` → se não achou, `create`. Duas execuções
simultâneas do cron (um retry da Vercel basta) encontrariam ambas "não existe",
ambas criariam, e a segunda estouraria violação de chave única no meio do laço —
abortando a importação daquela central.

Resolvido pela mesma mudança: `createMany({ skipDuplicates: true })` delega a
decisão ao banco, que é quem tem como decidir sem corrida.

---

## O que alcança o sistema inteiro

### 3. Data com formato certo e valor impossível

`parseIsoDateTz` conferia se a string casava `\d{4}-\d{2}-\d{2}` e montava a data.
A montagem transborda em silêncio:

```
"2026-13-45"  ->  Sáb 14 Fev 2027
"2026-02-31"  ->  03/03
"9999-99-99"  ->  ano 10007
```

O valor passava pela validação e era **gravado como outra data**, sem erro e sem
aviso — com a tela depois exibindo um dia que ninguém digitou.

Isso não é do módulo de cotações. `parseFormDateTz` é obrigatório em todo campo
de data escolhido pelo usuário, e alimenta **sete serviços**: venda, compra,
despesa, fiado, caixas, embalagens e higienização. Uma conta de fiado nasceria
vencida em fevereiro do ano seguinte. O `<input type="date">` do navegador não
produz esses valores, mas a API aceita JSON de qualquer origem, e um seletor de
data quebrado num aparelho antigo produz.

A correção é a volta: se os campos civis da data montada não são os que
entraram, a data não existe e a função devolve `null`.

No módulo de cotações o impacto seria pior que em qualquer outro, e é por isso
que o achado apareceu aqui: a tela mostra o boletim de `MAX(quoteDate)`. Uma data
futura por erro de digitação viraria "o mais recente" e passaria a ser o preço
exibido para **todos os clientes daquela central**, indefinidamente — nenhum
boletim real a superaria. Por isso a data do formulário do admin também passou a
ser validada na entrada, com recusa explícita de data futura.

---

## O erro silencioso que a fonte quase nos impôs

Não é um defeito corrigido, e sim uma armadilha da fonte que o desenho teve de
absorver. Fica registrado porque é o que mais custaria se passasse.

O boletim da CEASAMINAS é servido por um ScriptCase que repassa o parâmetro cru a
uma *stored procedure* de SQL Server. **A data vai em MM/DD/AAAA**, embora a tela
seja brasileira e ecoe DD/MM. Medido:

```
28/08/2026  ->  Error converting data type varchar to datetime   (mês 28)
04/09/2026  ->  HTTP 200, página perfeita, boletim de 9 de ABRIL
09/04/2026  ->  HTTP 200, boletim de 4 de setembro, 215 produtos
```

O primeiro caso é barulhento e fácil. O segundo é o perigoso: resposta 200,
página bem formada, dados do mês errado. O cliente precificaria por um boletim de
cinco meses atrás sem nada indicar.

Duas defesas: o adaptador confere a data que a **própria página** informa contra
a que foi pedida e recusa quando divergem; e a migration `20260907180000` corrige
o identificador do mercado, que estava gravado como `"CEAMG"` quando o formulário
usa IDs numéricos (`214`) — com a string errada a procedure não acha o mercado e
devolve 200 com zero linhas, ou seja, "dia sem boletim" todos os dias, para
sempre, sem alarme.

---

## Varredura do restante do código

O que foi verificado e **não** produziu achado:

- **Injeção de SQL**: dez arquivos usam SQL cru. Os dois `queryRawUnsafe` de
  `estoque.service.ts` passam valores como parâmetros (`$1`, `$2`) com a query
  constante — não há interpolação de entrada em lugar nenhum.
- **Escopo de empresa**: todas as consultas do módulo novo passam `tenantId`
  explícito; o teste de isolamento foi conferido reprovando quando a checagem é
  removida.
- **Exclusão lógica**: as três consultas de `products` do módulo filtram
  `deletedAt: null`.
- **Rotas de API sem autenticação**: as nove são todas pré-autenticação (login,
  cadastro, recuperação, OAuth, health) — é onde a sessão nasce. A proteção ali é
  rate limit, presente em todas as que precisam. As quatro sem limite
  (`google/callback`, `logout`, `refresh`, `renovar`) são defensáveis:
  `callback` exige state token assinado de uso único, `logout` é idempotente, e
  limitar `refresh`/`renovar` quebraria abas concorrentes — a proteção deles é a
  detecção de reuso.
- **Índices**: `ceasa_quotes(centralCode, quoteDate)` e
  `tenant_ceasa_links(tenantId, ceasaProductId)` cobrem a consulta do painel; a
  junção lateral do saldo usa `stock_movements(tenantId, productId, movedAt)`,
  que já existia.
- **Os 89 testes-guarda** (cobertura de models multi-tenant, rótulos de enum,
  gates de módulo em ações e páginas, matcher do proxy, roteiro do tour, grupos
  de relatório, fuso nos serviços) passam.
- **Sem `console.log`, `debugger`, `TODO` ou `FIXME`** no código novo.

---

## Uma lacuna de produto, fechada

Quem contratava o módulo e escolhia a central abria uma tela vazia e ficava assim
até o cron da madrugada seguinte — pagando por um recurso que, na primeira
impressão, não fazia nada. A escolha da central passou a disparar a importação
daquela central em `after()` (depois da resposta, como o cadastro público já
fazia), e só quando a central ainda não tem nenhum boletim.

---

## Verificação

Todo o conjunto, depois das correções:

```
lint (--max-warnings=0)   ok
typecheck                 ok
599 testes unitários      ok
444 testes de integração  ok
build                     ok
98 testes E2E             ok
```

Duas observações sobre como rodar, aprendidas nesta rodada:

- **O E2E precisa de porta própria quando há `next dev` aberto.**
  `reuseExistingServer` está ligado fora do CI, então o Playwright reusa o
  servidor de desenvolvimento em vez de subir o build de produção — e o service
  worker não se comporta igual, o que reprova os testes de consulta offline por
  motivo nenhum. Use `E2E_PORT=3123 PORT=3123 npx playwright test`.
- **Nunca aponte `--shadow-database-url` para o banco de desenvolvimento.** O
  `prisma migrate diff --from-migrations` usa o banco indicado como rascunho e o
  reinicializa. Foi como o banco local desta máquina foi zerado durante esta
  auditoria; recuperado com `SEED_DEMO=true npm run db:seed`.

---

## Adendo — 2026-09-08: revisão da coleta de UF/central

Segunda rodada, depois de o cadastro passar a coletar estado e central e de o
catálogo ir para 66 unidades. Seis defeitos a mais, com destaque para um que
mataria o módulo em produção sem aparecer em teste nenhum.

| # | Onde | Defeito |
|---|---|---|
| 12 | `cotacoes-import.service.ts` | **Central manual entupia a fila do cron** e as automáticas nunca eram importadas |
| 13 | `frescor.ts` + `cotacoes/page.tsx` | A explicação da idade do dado culpava a cadência da central mesmo quando a causa era ausência de fonte |
| 14 | `admin/cotacoes/page.tsx` | Central manual pintada de amarelo para sempre, enquanto o alarme foi ensinado a ignorá-la |
| 15 | `configuracoes/page.tsx` | Quem escolheu central no cadastro e não tem o módulo não conseguia trocá-la nem limpá-la |
| 16 | `signup.service.ts` | A partida a frio da importação rodava em Configurações mas não no cadastro |
| 17 | `20260907220000` | Quatro erros de FATO no catálogo nacional |

### 12. A fila do cron travada pelas centrais manuais

A fila é ordenada por "quem está mais atrasado primeiro", para nenhuma central
passar fome. Só que central manual **nunca** recebe boletim automático: ela é
eternamente a mais atrasada e vai eternamente para a frente da fila. Com a pausa
de 2 s entre centrais e o orçamento de 40 s, bastam ~20 clientes em praças
manuais para as centrais AUTOMÁTICAS nunca serem tocadas.

O desfecho não seria erro: o cron termina "com sucesso", só não chegou lá. O
cliente que paga e tem fonte de verdade ficaria sem boletim, todo dia.

O teste que prova reprova em **4059 ms** sem a correção — as pausas de 2 s, que
são o mecanismo exato do defeito.

### 17. O catálogo nacional tinha erros de fato

A lista nacional foi montada de conhecimento geral, sem conferir unidade por
unidade. Quatro erros confirmados depois, nos sites das próprias companhias:

- **Santa Catarina tem TRÊS unidades** (São José, Blumenau, Tubarão). Eu havia
  cadastrado seis: Joinville, Chapecó, Criciúma e Rio do Sul não existem, e
  Tubarão, que existe, faltava.
- **Ceará tem TRÊS entrepostos** (Maracanaú, Tianguá, Barbalha). Sobral não.
- **Rio de Janeiro tem SEIS unidades** e nenhuma em Campos dos Goytacazes; as
  outras cinco (São Gonçalo, Nova Friburgo, Itaocara, São José de Ubá, Paty do
  Alferes) faltavam.
- **Curitiba**: a unidade fica em Curitiba (Tatuquara), não em São José dos
  Pinhais.

Central inventada foi DELETADA, não desativada: ela não existe no mundo, e a FK
`ON DELETE SET NULL` devolve a empresa para "sem central" — o desfecho correto
quando a opção anterior era falsa.

### Sobre o método desta rodada

A revisão rodou como quatro lentes independentes (correção, produto, dados,
segurança) com uma fase adversarial de refutação. **A fase de refutação falhou
por limite de sessão em 14 dos 15 achados**, e o script tratou veredito ausente
como "refutado" — o que é enganoso. Só 1 achado foi de fato confrontado por um
verificador; os demais foram verificados por mim, lendo o código e, no caso do
catálogo, consultando as fontes oficiais. Dois achados não se sustentaram:

- "O cadastro pelo Google descarta em silêncio o estado e a central" — o botão
  do Google é um `<a>` que navega. Abandonar o formulário perde TODOS os campos,
  inclusive o e-mail digitado. É inerente a ter dois caminhos de cadastro na
  mesma página, e é comportamento anterior a esta mudança.
- "Nem cliente nem operador têm sinal" (sobre central manual parada) — o
  operador tem: `/admin/cotacoes` já mostrava a central com selo de idade. O que
  faltava era a tela não confundir "sem fonte" com "fonte quebrada", que é o
  defeito 14.

## Riscos residuais

1. **A importação depende de raspagem**, e raspagem quebra quando o site de
   origem muda. O desenho não evita isso; garante que a quebra apareça — três
   camadas de alarme (erro da fonte, assinatura estrutural, defasagem), sendo a
   última a única que um defeito nas outras duas não desarma.
2. **Só a CEASAMINAS tem adaptador.** As demais centrais do país precisam de uma
   implementação cada; a interface já suporta, e a importação manual atende
   enquanto isso.
3. **O horário do cron é 06:30 BRT**, cedo para o boletim do próprio dia — o
   recuo de datas pega o do dia anterior. Um cron às 15:00 BRT pegaria o do dia,
   mas exigiria o plano Pro da Vercel (o Hobby está no teto de 2 agendamentos).
4. **O catálogo além de MG, ES, SC, CE, RJ e PR segue SEM verificação em fonte
   oficial.** As unidades de BA, PE, SP/CEAGESP, GO, MT, MS, PA, PB, PI, RN, RS e
   as capitais do Norte são plausíveis, mas devem ser tratadas como rascunho até
   alguém conferir — quatro dos primeiros seis estados que eu conferi estavam
   errados, então a taxa de erro do resto provavelmente não é zero. Corrigir é um
   `UPDATE`, não um deploy.
5. **57 das 66 centrais não têm busca automática.** A tela, o seletor e a
   descrição do plano dizem isso, mas é limitação real: só MG e ES têm raspador.
6. **O cadastro público entra no plano mais barato**, que não inclui módulos
   opcionais. Quem se cadastra escolhe a central mas só vê Cotações ao contratar
   um plano que a inclua. É decisão de produto, não defeito.
7. Os riscos residuais de `docs/auditoria-2026-09-05.md` seguem como estavam.
