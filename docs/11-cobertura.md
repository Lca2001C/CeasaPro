# Cobertura de testes — linha de base medida

Documento vivo. Registra **o que a suíte alcança de verdade**, medido com
instrumentação, e o que ficou descoberto e por quê.

Antes desta medição o projeto não tinha provider de cobertura instalado: havia
mais de mil casos de teste e nenhuma forma de saber onde a rede tinha buraco.

```
npm run test:coverage     # relatório em ./coverage/index.html
```

---

## 1. Linha de base — 10/09/2026

Medida com `@vitest/coverage-v8` sobre `tests/unit` + `tests/integration`
(1.301 casos, todos verdes).

| Métrica | Cobertura |
|---|---|
| Statements | **40,87%** (3.475/8.502) |
| Branches | **32,86%** (2.257/6.868) |
| Functions | **34,63%** (745/2.151) |
| Lines | **41,43%** (3.149/7.599) |

### O denominador não é o que parece

`src/` tem 47.493 linhas físicas, mas o v8 instrumenta **linha executável**, não
linha de arquivo — e a maior parte do JSX é marcação, não instrução. O
denominador real é **7.599 linhas**, distribuídas assim:

| | arquivos | linhas exec. | cobertura |
|---|---|---|---|
| `.ts` (lógica) | 169 | 4.731 | **66,6%** |
| `.tsx` (UI) | 173 | 2.868 | **0,0%** |

Isso reordena a prioridade: a lógica de negócio já está razoavelmente coberta, e
o zero absoluto está na UI e nas camadas de entrada.

### Por pasta, do maior para o menor

| Pasta | arquivos | linhas | cobertura | leitura |
|---|---|---|---|---|
| `lib/services` | 31 | 2.062 | **85,8%** | já bem coberto |
| `app/(app)` | 80 | 1.570 | **0,0%** | nenhum teste de render existe |
| `lib/cotacoes` | 13 | 463 | 78,8% | funções puras, bem cobertas |
| `app/api` | 25 | 382 | **0,0%** | 25 rotas, nenhuma executada em processo |
| `app/(admin)` | 19 | 329 | **0,0%** | |
| `lib/auth` | 15 | 237 | 73,4% | |
| `lib/reports` | 5 | 207 | 52,2% | |
| `lib/payments` | 3 | 144 | 60,4% | |
| `app/(auth)` | 11 | 133 | **0,0%** | |
| `lib/validations` | 16 | 127 | 57,5% | 9 dos 16 Zod em 0% |
| **`lib/http`** | 6 | 115 | **18,3%** | **os wrappers de entrada** |
| `lib/pwa` | 5 | 107 | 4,7% | |
| **`proxy.ts`** | 1 | 81 | **7,4%** | **o porteiro** |
| `actions/*` (13 arq.) | 13 | ~148 | **0,0%** | nenhuma action executada |
| `components/*` (53 arq.) | 53 | ~670 | **0,0%** | |

100% de cobertura foi **descartado como alvo**, de forma deliberada e acordada:
cobrir a casca do App Router (`layout.tsx`, `generateMetadata`, shells de Server
Component) exige teste que não afirma comportamento nenhum — ele faz o número
subir e não falha quando a regra quebra. O alvo é limiar alto onde há risco,
travado no CI, e está na Etapa 5 desta auditoria.

---

## 2. O que ficou de fora da medição, e por quê

Configurado em `vitest.config.ts`, bloco `coverage.exclude`:

| Excluído | Motivo |
|---|---|
| `src/**/*.d.ts` | declaração de tipo não executa |
| `src/app/**/layout.tsx` | monta provider e shell; sem regra a afirmar, e o `next build` já quebra se o tipo errar |
| `src/app/**/opengraph-image.tsx`, `twitter-image.tsx` | imagem gerada no build |
| `src/app/robots.ts` | metadado consumido pelo framework |

`src/app/manifest.ts` **continua incluído** — tem teste próprio
(`tests/unit/pwa-manifest.test.ts`).

Todo arquivo que casa com `include` entra no relatório, tenha teste ou não — é
o que impede a cobertura de subir por omissão, contando só o que alguém já se
lembrou de testar. (No Vitest 4 isso é o padrão; a opção `all` saiu da API.)

---

## 3. Duas armadilhas encontradas ao instalar a medição

Registradas porque custaram tempo e vão voltar.

**O `test:coverage` roda unit e integração no MESMO processo.** O CI roda
`test:unit` e `test:integration` como dois comandos separados. Juntar os dois
muda a ordem dos arquivos sobre um banco compartilhado. Hoje passa (1.301
verdes), mas se voltar a falhar com sintoma de estado vazado — "esperava ATIVO,
recebeu SUSPENSO", "esperava este plano, recebeu outro" — é aqui que se olha
primeiro.

**Execução interrompida deixa lixo no banco, e o lixo quebra teste.** Uma
execução morta no meio deixou 184 empresas, 130 usuários e 30 planos órfãos. O
teste `signup-trial` procura "o plano ativo mais barato" e passou a achar um
plano de R$ 5,00 deixado por outro teste — 35 falhas que não tinham nada a ver
com o código. Se a suíte começar a falhar em bloco sem mudança de código,
conferir contagem de `tenant`/`plan` antes de investigar o código.

---

## 4. Vulnerabilidades de dependência

`npm audit` reportava **8** (4 altas, 4 moderadas) — a aba do Dependabot mostra
menos porque conta só dependências de produção.

### Corrigidas

| Pacote | Severidade | Advisory | Como |
|---|---|---|---|
| `vitest`, `@vitest/mocker` | moderada | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) — path traversal via mock de redirect | subiu para 4.1.11 ao instalar o provider de cobertura; o range em `package.json` foi fechado em `^4.1.11` para um `npm ci` não voltar à versão vulnerável |

Restam **6**. As demais estão em análise na Etapa 4 desta auditoria.

---

## 5. Progresso da auditoria

### Etapa 2a — as camadas de entrada (10/09)

Os quatro arquivos por onde passam as 13 Server Actions e as 11 rotas
transacionais. Nenhum era executado por teste; a única verificação era uma
regex sobre o texto do fonte.

| Arquivo | antes | depois (linhas / branches) |
|---|---|---|
| `lib/http/with-action.ts` | 0% | **100% / 91,7%** |
| `lib/http/with-route.ts` | 0% | **100% / 95,5%** |
| `lib/auth/pagina.ts` | 0% | **100% / 100%** |
| `lib/auth/session.ts` | 0% | **100% / 100%** |
| `lib/http/error-response.ts` | 0% | 100% / 75% (de brinde) |
| `lib/security/rate-limit.ts` | 0% | 100% / 100% (de brinde) |
| **pasta `lib/http`** | **18,3%** | **94,8%** |
| **pasta `lib/auth`** | 73,4% | **82,3%** |

Total: 41,43% → **43,00%** de linha; 1.301 → 1.368 casos.

**Cada teste foi provado por remoção.** Tirar `assertActive` derruba 3 casos;
fazer o `tenantId` vir do corpo derruba 1; tirar `requireModule` derruba 3;
tirar `assertSessaoValida` derruba 2; ignorar `allowInactive` derruba 1;
inverter a ordem de assinatura e módulo derruba 1. Teste que não falha quando
a proteção sai não é rede, é decoração.

O que estes testes fixam, e que antes ninguém garantia:

- o `tenantId` do contexto vem da SESSÃO, e o valor mandado no corpo é
  ignorado (regra 1 do briefing);
- assinatura bloqueada não executa o handler — nem em action, nem em rota;
- `allowInactive` e `permiteInativo` deixam o bloqueado chegar à tela de
  pagamento, que é como ele regulariza;
- o gate de módulo é fail-closed: token sem o claim `modules` não libera nada;
- erro inesperado não vaza mensagem interna, e devolve uma referência;
- `withAdminAction` **não** checa assinatura (o operador da plataforma não é
  cliente pagante) — fixado para ninguém "uniformizar" os dois wrappers e
  trancar o admin fora do painel.

### Etapa 3a — os estados de tela que não existiam (10/09)

Aqui não era falta de teste, era falta de código. A árvore inteira tinha
**zero** `error.tsx`, `not-found.tsx` e `loading.tsx`, e o `Skeleton` de
`ui/skeleton.tsx` estava lá com zero usos.

| Antes | Depois |
|---|---|
| exceção em Server Component → página de erro crua do Next, sem menu | boundary dentro do AppShell, com `retry()` e o `digest` para o suporte |
| 10 chamadas de `notFound()` → 404 padrão, em inglês, sem saída | tela em português com navegação e caminho de volta |
| erro no layout raiz → 500 do framework | `global-error.tsx` com estilo inline (o Next não passa os estilos globais ali) |
| navegar no 3G não mostrava nada | 7 `loading.tsx` com contorno da tela, não spinner |
| recusa do PDV só em toast `top-center`, com o botão no rodapé | mensagem também junto do botão, derivada e com `role="alert"` |

**A documentação do Next foi lida antes de escrever, e isso evitou dois
defeitos.** Nesta versão a prop do boundary é `retry`, não `reset` — escrever
de memória teria produzido um botão que chama `undefined`. E `global-error`
renderiza o próprio documento **sem** os estilos globais, então classe do
Tailwind ali não aplica nada.

**Uma regressão que eu mesmo causei, e o que ela ensina.** Criar
`not-found.tsx` mudou o status de `notFound()` de 404 para 200: a resposta
passou a ser transmitida em fluxo, e a documentação diz que streaming devolve
200. Um teste de cotações cobrava o 404 e quebrou. Passou a afirmar o que a
pessoa vê — que é o que ele queria dizer desde o começo.

### Etapa 2b — as rotas de autenticação (10/09)

A lógica por baixo já era bem coberta (Argon2, JWT, rotação de refresh,
contador no Postgres). O que ninguém executava era a **fiação** — e é aí que
mora o defeito de "o serviço protege, mas a rota esqueceu de chamar".

| Arquivo | antes | depois |
|---|---|---|
| `api/auth/login/route.ts` | 0% | **100%** |
| `api/auth/change-password/route.ts` | 0% | **96,7%** |
| pasta `api/auth` | 0% | 24,9% |

O que passou a estar garantido:

- **login não vira oráculo de contas**: e-mail inexistente e senha errada
  devolvem resposta idêntica, e o hash de isca é verificado mesmo sem usuário
  — mensagem igual não basta, porque a DIFERENÇA DE TEMPO entrega a mesma
  informação;
- os **dois** limites de tentativa são consultados, e o de e-mail é mais
  folgado que o de IP (iguais, trancar a conta de um concorrente sairia
  barato);
- o acerto **libera** a janela: sem isso, entrar do celular e do computador
  trancaria a própria conta;
- a troca de senha **revoga as outras sessões** — é a razão de a rota
  existir — e revoga ANTES de criar o novo refresh, senão a pessoa troca a
  senha e é deslogada no mesmo instante;
- a troca apaga o token de recuperação pendente: um link de "esqueci minha
  senha" circulando no e-mail continuaria valendo depois.

### Etapa 2c — a marca, e o ícone que era de outra pessoa (10/09)

O pedido era "fazer uma logo do site para aparecer no Google", a partir de um
resultado de busca que mostrava o globo genérico. O diagnóstico inicial —
"falta favicon" — estava **errado**, e vale registrar porque foi a leitura do
código que corrigiu.

**O que estava publicado.** `src/app/favicon.ico` existia desde a fase 1 e era
o ícone do TEMPLATE do Next: círculo preto com triângulo branco, o que vem no
`create-next-app`. O site anunciava a marca de outra pessoa na aba do navegador
e no resultado de busca. Nada no CI reparava — ícone é binário, e binário não
aparece em revisão de diff.

**Duas armadilhas encontradas no caminho, ambas verificadas na fonte e não
supostas:**

1. **`public/favicon.ico` COLIDE com `src/app/favicon.ico`.** A primeira
   tentativa foi gerar o ícone em `public/`. O Next responde
   "A conflicting public file and page file was found for path /favicon.ico"
   (`router-server.js`) — o arquivo teria derrubado a rota, não consertado nada.
2. **As duas origens de ícone do Next não são simétricas.** Em
   `resolve-metadata.js`, o favicon de convenção entra com
   `icon.unshift(favicon)` **sempre**, mesmo com `metadata.icons` declarado; já
   os demais arquivos de convenção são ignorados quando ele existe. Declarar
   `/favicon.ico` no `metadata.icons` sairia como dois `<link>` iguais.

**Dois geradores para os mesmos arquivos.** Havia `scripts/generate-icons.mjs`
(sem dependência de imagem, desenhando o "C" por geometria) e eu havia escrito
um segundo apoiado em `sharp`. `sharp` está aqui só como dependência
**transitiva** do Next: um script do repositório apoiado nisso quebra em
silêncio no dia em que o Next trocar de rasterizador. Os dois foram
consolidados no gerador sem dependência, que agora é a única origem da marca —
e o teste cobra que o duplicado não volte.

**O que mudou no desenho.** O anel tinha 12,8% do lado do quadro e a 16px o "C"
virava um borrão esverdeado com um risco claro; passou a 18,75%. E o
rasterizador decidia cada pixel por um único teste no canto, sem antisserrilha:
o defeito é invisível a 512px e gritante a 16px, que é o tamanho de uso real.
Agora cada pixel de borda é amostrado 4 × 4.

**A medida que virou teste.** Contar branco PURO não serve para medir a marca:
a 16px quase todo o "C" é mistura, e o mesmo desenho mede 0,17 a 16px e 0,26 a
512px. Como os dois tons são conhecidos e a mistura é linear, dá para recuperar
a fração de branco pelo canal vermelho — e aí a medida é a MESMA em qualquer
resolução:

| arquivo | tinta medida |
|---|---|
| `.ico` 16px | 0,2549 |
| `.ico` 32px | 0,2570 |
| `.ico` 48px | 0,2579 |
| `icon-192.png` | 0,2587 |
| `icon-512.png` | 0,2588 |
| `icon-maskable-512.png` | 0,1656 |

O valor bate com a conta geométrica (0,2588), o anel antigo dá 0,1519, e o
maskable é exatamente 0,8² do cheio — que é a zona segura da máscara circular
do Android. Os três números viraram asserção.

**`tests/unit/marca-e-favicon.test.ts` (27 casos)** decodifica o ICO e o PNG na
mão e afirma propriedades, não bytes: que o ícone é a marca (verde e branco,
sem preto — é isto que pega o ícone do template), que tem 16/32/48 quadrados,
que o traço tem piso e TETO (fechar a abertura até virar um disco branco seria
o defeito oposto), e que um rastreador **sem cookie** alcança cada caminho —
a mesma classe de furo da imagem de link corrigida na Etapa 4.

**Logotipo no JSON-LD.** A landing publicava só `SoftwareApplication`: não
havia `logo` nenhum na página. Passou a emitir um `@graph` com `Organization`
(que é o nó que carrega `logo`) amarrado ao produto por `@id`.

**Verificado com build de produção e requisição sem cookie**, não por leitura:

```
/favicon.ico              status=200 tipo=image/x-icon  920 bytes
/icons/icon-192.png       status=200 tipo=image/png    1842 bytes
/icons/icon-512.png       status=200 tipo=image/png    5525 bytes
/icons/apple-touch-icon…  status=200 tipo=image/png    1739 bytes
/manifest.webmanifest     status=200 tipo=application/manifest+json
```

O `<head>` sai com quatro `<link>` de ícone e nenhum duplicado, e o JSON-LD com
um único `@context` e o nonce da requisição.

**Seis mutações injetadas, seis apanhadas:** ícone do template de volta (4
casos falham), anel fino de antes (3), `icons/` fora do matcher do proxy (5),
`.ico` declarado também no `metadata.icons` (1), `publisher` removido do grafo
(1), maskable sem zona segura (1).

**Ressalva honesta.** Isto garante que o site *serve* a marca certa, de forma
alcançável e declarada. Não garante *quando* o Google vai trocar o globo pelo
ícone: isso depende de recrawl, e nenhum código aqui controla o calendário do
rastreador.

### Etapa 3 — os três tipos de teste que não existiam, e o que eles acharam (11/09)

As devDependencies de teste eram exatamente duas (`vitest`, `@playwright/test`).
Sem `jsdom` nem testing-library, **nenhum teste de componente era possível**;
sem axe, **nenhuma verificação de acessibilidade**. Os dois passaram a existir.

#### O que a primeira varredura encontrou

Tudo abaixo estava publicado, e nada no CI podia ter apanhado:

| Defeito | Alcance | Impacto |
|---|---|---|
| `maximumScale: 1` no viewport | **toda página** | zoom por pinça DESLIGADO (WCAG 1.4.4) |
| `--warning` a 2,86:1 | 31 usos de `text-warning`, 7 selos, 9 StatCards | reprovava nos dois sentidos |
| `bg-destructive/10` a 4,46:1 | selo de conta VENCIDA | reprovava por uma casa decimal |
| rótulo solto do campo | 5 telas de formulário | `label`/`select-name`, impacto **crítico** |
| botão só com ícone sem nome | compra | `button-name`, impacto **crítico** |
| sem marco `<main>` | `/assinatura` e as 4 telas de autenticação | `landmark-one-main`, `region` |
| `CardTitle` fixo em `<h3>` | 3 telas medidas | salto h1 → h3 |
| `<nav>` sem rótulo | 3 navegações | leitor anuncia "navegação" sem distinguir |
| `aria-current` ausente | todo o app | tela atual marcada **só por cor** |
| sem link para pular a navegação | todo o app | 16 itens atravessados em cada tela |

O mais amplo é o primeiro, e ele é instrutivo: `maximumScale: 1` costuma ser
posto para impedir o iOS de dar zoom sozinho no campo focado. Só que a causa
disso é fonte menor que 16px, e `Input`, `Select` e `Textarea` já usam
`text-base`. Era pagar o preço sem ter a doença — e o preço recaía justamente
sobre quem enxerga pouco, que é boa parte do público deste app.

#### Medição, antes e depois

Varredura do axe em 29 telas, com build de produção:

| | antes | depois |
|---|---|---|
| telas com violação séria/crítica | 5 | **0** |
| violações sérias/críticas | 10 | **0** |
| telas com violação moderada | 4 | **0** |

#### Contraste: a conta, não a impressão

Os tokens foram convertidos de HSL para sRGB e a razão calculada pela fórmula
da WCAG, compondo as transparências reais (`bg-destructive/10` sobre branco):

| par | antes | depois |
|---|---|---|
| `text-warning` sobre o cartão | 2,86:1 | **5,20:1** |
| branco sobre `bg-warning` | 2,86:1 | **5,20:1** |
| `text-destructive` sobre `bg-destructive/10` | 4,46:1 | **5,13:1** |
| branco sobre o botão destrutivo | 5,22:1 | **6,03:1** |

A conta virou teste (`tests/unit/contraste-de-cor.test.ts`, 11 casos) que lê os
tokens do próprio `globals.css`. É o único lugar onde isso é verificável sem
depender de alguém ter aberto a tela certa: o axe só vê o par que está na tela
naquele instante.

**Dívida registrada, com número:** `--border`/`--input` rende 1,30:1 contra o
branco, abaixo dos 3:1 da WCAG 1.4.11. **Não** foi corrigido, e o motivo é
honesto — chegar a 3:1 exige um cinza médio em toda borda do app, o que é
mudança de aparência do produto, não conserto de defeito, e a decisão é de quem
é dono da marca. O teste trava o número atual nos dois sentidos: falha se
alguém clarear ainda mais, e falha pedindo promoção se alguém corrigir.

#### Lint de acessibilidade, medido antes de ligar

`eslint-plugin-jsx-a11y` era transitivo do `eslint-config-next`, com 6 das 32
regras ligadas. Passou a dependência direta. **Das 32 regras do conjunto
recomendado, 30 já passavam limpas** — ligar em `error` foi o retrato, não uma
aposta. Das duas que sobravam, ambas eram falso positivo de primitivo
(`CardTitle` e `Label` recebem conteúdo e `htmlFor` por `{...props}`, e a regra
não segue composição), desligadas linha a linha com o motivo escrito.

`no-autofocus` ficou desligada com justificativa: são 19 usos, todos no
primeiro campo de um formulário que a pessoa ABRIU — nenhum caso de roubar o
foco em página de conteúdo, que é o dano que a regra existe para evitar. A
mitigação entrou junto (título antes do formulário, link para pular a
navegação).

Uma armadilha registrada: o plugin **não** pode ser redeclarado, porque o
`eslint-config-next` já o registra — responde `Cannot redefine plugin
"jsx-a11y"`. Só as regras entram.

#### Testes de componente

`vitest.config.ts` passou a ter **dois projects**: `node` (as três travas de
segurança, em série porque compartilha o Postgres) e `dom` (jsdom, paralelo,
sem banco). O `tests/setup/dom.ts` traz a limpeza entre casos — sem ela cada
`render` empilha no mesmo `document.body` e `getByRole` acha o botão do teste
ANTERIOR, ficando verde sobre a árvore errada.

Dois arquivos, 19 casos, nos componentes que o mapeamento apontou como os de
maior consequência:

- **`SeloDeVariacao`**: prende que **alta é vermelha e baixa é verde** — o
  inverso do mercado financeiro, de propósito, porque para o comerciante a
  cotação é o preço que ele PAGA. É o tipo de inversão que alguém "conserta"
  numa tarde achando que é bug;
- **`CurrencyInput`/`QuantityInput`**: o contrato de entrada de dinheiro e
  quantidade de umas quinze telas.

O segundo achou algo que eu supus errado: **não é máscara de centavos**.
Digitar "1234" dá R$ 1.234,00, e não R$ 12,34 — os centavos só abrem na
vírgula. Muito PDV usa a outra convenção, e a diferença é de cem vezes. O teste
passou a prender o comportamento REAL, para que uma eventual mudança seja uma
escolha e não um acidente num ajuste de `decimalScale`.

#### Cobertura, e uma ressalva que o número exige

| | linha de base (10/09) | agora |
|---|---|---|
| Statements | 40,87% | **44,73%** |
| Lines | 41,43% | **45,46%** |
| `.tsx` | 0,0% | 0,6% |

O 0,6% de `.tsx` é honesto e **não** significa que o JSX está desverificado.
São 158 testes E2E atravessando essas telas — mas eles rodam contra um servidor
de produção já compilado, que o v8 do Vitest não instrumenta. O número de
`.tsx` mede só o que o projeto `dom` alcança, e ele tem dois arquivos. A
infraestrutura passou a existir e os primeiros testes estão escritos; cobrir os
53 componentes é trabalho de mais de uma etapa.

#### Verificação

`lint` 0 avisos · `typecheck` limpo · **1513** unit + integração · **19**
componente · **158** E2E (eram 123) · build exit 0.
