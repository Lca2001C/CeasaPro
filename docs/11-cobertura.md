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
