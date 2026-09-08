# Auditoria de produção — 2026-09-08 (módulos restantes)

Segundo ciclo da caça a erros de produção, nos módulos que o ciclo de 2026-09-03
não cobriu: auth/login Google, billing, fiado, cadastro/trial, super-admin,
despesas, caixas/higienização, painel e avisos, PWA/push, onboarding,
configurações/tour e relatórios.

Método, igual ao ciclo anterior: **cada achado é confirmado no código antes de
virar correção**, cada correção resolve uma causa raiz, e cada uma vem com teste
que **reprova contra o código anterior** — verificado rodando o teste novo com o
arquivo revertido.

Fora de escopo por combinação: o **PDV** (`src/app/(app)/vendas/nova/**`,
`vendas.service.ts`, `validations/venda.ts`). Nada ali foi editado; o defeito de
fuso que o alcança está registrado como pendência declarada no teste (§10).

---

## Resumo

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| 1 | Login Google adotava cadastro plantado e mantinha a senha do impostor | **Alta — sequestro de conta** | Corrigido |
| 2 | Login Google dava teste grátis a empresa cadastrada pelo admin | Média — receita | Corrigido |
| 3 | `googleSub` de conta excluída travava o retorno do cliente (500) | Alta — cliente sem entrada | Corrigido |
| 4 | Data de formulário virava o dia anterior, em 5 módulos | Alta — dado errado | Corrigido |
| 5 | Dois pagamentos de fiado simultâneos: um desaparecia do saldo | **Alta — dinheiro** | Corrigido |
| 6 | Painel de fiado contava as caixas do mesmo cliente uma vez por conta | Média | Corrigido |
| 7 | Saldo de caixas por cliente não fechava com o do box | Média — estoque | Corrigido |
| 8 | Cobrança PIX vencida trancava a tela: cliente não conseguia pagar | **Alta — receita** | Corrigido |
| 9 | Pagar o QR antigo, mais barato, liberava o plano novo inteiro | **Alta — receita** | Corrigido |
| 10 | Reconciliação nunca alcançava as cobranças novas (lote cheio) | Média — pagou e não entrou | Corrigido |
| 11 | Link de confirmação expirado era beco sem saída | Alta — perde o cliente | Corrigido |
| 12 | "Seu teste grátis terminou" no primeiro dia do teste | Média | Corrigido |
| 13 | CNPJ em branco ocupava índice único e travava as outras empresas | **Alta** | Corrigido |
| 14 | MRR e "assinaturas por status" contavam empresa excluída | Média — decisão de preço | Corrigido |
| 15 | Cartão "Sem acesso" marcava 0 por cortar justamente os desativados | Baixa | Corrigido |
| 16 | Higienização: devolução e pagamento simultâneos perdiam um | **Alta — dinheiro/estoque** | Corrigido |
| 17 | Editar envio com perda registrada deixava o saldo negativo | Média — estoque | Corrigido |
| 18 | "Replicar mês anterior" replicava o mês corrente | Alta — atalho inútil | Corrigido |
| 19 | Replicar o mês matava a recorrência em silêncio | **Alta — conta desaparece** | Corrigido |
| 20 | Painel: lucro do mês inflado até os vencimentos chegarem | **Alta — decisão de preço** | Corrigido |
| 21 | "Contas do mês" somava pendente de qualquer mês | Média | Corrigido |
| 22 | Aviso de higienização ignorava o plano e levava ao paywall | Média | Corrigido |
| 23 | Refinar dentro de "Vencidas" respondia outra pergunta | Média | Corrigido |
| 24 | Teste travava a suíte em banco reaproveitado | — lacuna | Corrigido |
| 25 | "Sair" sem internet não fazia nada e deixava os dados no aparelho | **Alta — privacidade** | Corrigido |
| 26 | Push ia para o dono anterior do celular compartilhado | **Alta — vaza entre empresas** | Corrigido |
| 27 | Quem perdeu o acesso continuava recebendo o aviso diário | Média | Corrigido |
| 28 | Relatório de fiado contava as caixas do cliente uma vez por conta | Alta — dado errado | Corrigido |
| 29 | Pagamento parcelado ao higienizador saía no dia errado no fluxo de caixa | Média — lucro inflado | Corrigido |
| 30 | Quatro relatórios pagos ficavam liberados em qualquer plano | Média — receita | Corrigido |
| 31 | Passo 1 do onboarding apagava telefone, CNPJ e razão social | **Alta — perda de dado** | Corrigido |
| 32 | Configurações dizia "vencimento" com a data do cadastro no teste | Média | Corrigido |
| 33 | O tour prometia que o guia abre sem internet | Baixa | Corrigido |
| 34 | Varredura de layout ignorava em silêncio os cartões de destaque | — lacuna | Corrigido |
| — | Canonicalização de e-mail do Gmail (teste grátis repetível) | — | **Decisão de produto** (§11) |

Regressão final: `prisma validate`, `lint --max-warnings=0`, `typecheck`,
**85 arquivos de teste / 986 testes** verdes (eram 765 no início do ciclo),
`build` e E2E.

---

## 1–2. Login com Google confiava num cadastro não confirmado

**Sintoma.** Sequestro de conta completo, sem nada de exótico:

1. O atacante se cadastra em `/cadastro` com o e-mail de um comerciante e uma
   senha que ele escolhe. O cadastro público cria a linha de `User` com essa
   senha e `emailVerifiedAt: null` (`signup.service.ts:103`). Ele **nunca**
   clica no link. A empresa nasce SUSPENSA, sem acesso — o cadastro, por
   enquanto, não serve para nada.
2. O dono real clica em "Entrar com Google". O Google confirma que o e-mail é
   dele.
3. `resolverLoginGoogle` achava a linha pelo e-mail e a adotava: gravava o
   `googleSub`, carimbava `emailVerifiedAt` e liberava o teste grátis. **A senha
   do atacante continuava valendo.**
4. O comerciante trabalha semanas ali: vendas, fiado, clientes.
5. O atacante entra por e-mail e senha — `/api/auth/login` autentica com
   `active: true, deletedAt: null` e **não** olha `emailVerifiedAt`
   (`login/route.ts:49`). O acesso, que antes não existia, foi liberado pela
   própria vítima.

**Causa.** O caminho de adoção não distinguia conta confirmada de cadastro
pendente. O docblock descrevia a adoção como intencional, e o teste
`google-login.test.ts:176` congelava o comportamento: criava a linha com
`passwordHash` conhecido e só verificava que o trial saiu.

**Correção.** Quando a linha adotada nunca confirmou o e-mail, a credencial de
origem não comprovada não sobrevive ao vínculo: senha aleatória, tokens de
confirmação e de recuperação apagados, sessões revogadas (o atacante podia ter
um refresh de 30 dias). Conta **já confirmada** é a mesma pessoa e mantém a
senha — há teste cobrando isso, para a correção não virar transtorno de quem usa
as duas formas de entrar.

**Achado 2, no mesmo caminho.** `concederTrialSePendente` passou a valer só para
o cadastro pendente. Toda empresa nasce SUSPENSA com `trialEndsAt` nulo, e o
cadastro pelo admin decide **de propósito** não dar os 7 dias
(`admin.service.ts:134`) — mas um clique no botão do Google dava o mês grátis a
ela. Como o admin já confirma o e-mail na criação, é o próprio
`emailVerifiedAt` que separa os dois casos.

Commit `05957ac`.

---

## 3. `googleSub` de conta excluída travava o retorno do cliente

Cliente que teve a conta excluída e volta pelo botão do Google recebia **500** —
não a mensagem genérica que o callback promete — e nunca mais entrava por lá,
nem depois de recadastrar por e-mail e senha.

`User.googleSub` é `@unique` e nenhum caminho de exclusão o liberava: as duas
exclusões carimbam o e-mail e limpam o token de recuperação, mas deixavam o
`googleSub` ocupado na linha soft-deletada para sempre. Gravar o vínculo na
conta nova estourava violação de índice dentro da transação, e o callback do
OAuth não tem `try/catch`. É o caso que a própria base trata como comum —
"errou no cadastro, exclui e faz de novo" (`admin.service.ts:320`).

Duas pontas, uma causa: a exclusão passou a liberar o vínculo, e o login solta
um `googleSub` que só uma conta excluída ainda segura. A segunda parte existe
porque a primeira não alcança as linhas que a base **já** tem presas.

Descartei no meio do caminho uma correção em `liberarEmailDeContaExcluida`: ela
busca a linha pelo e-mail **original**, e a exclusão carimba o e-mail, então
nunca a encontraria no caso real. Era código morto com comentário mentiroso — o
teste é que mostrou isso.

Commit `6bf9446`.

---

## 4. Data escolhida no formulário virava o dia anterior

**Sintoma.** O usuário digita vencimento 10/09 e a tela mostra **09/09**. A
conta de fiado nasce vencida um dia antes do combinado e entra no relatório de
inadimplentes antes da hora.

**Medido, não deduzido:**

```
digitado no formulário: 2026-09-10
new Date(cru)      -> 2026-09-10T00:00:00.000Z -> tela: 09/09/2026
parseFormDateTz    -> 2026-09-10T03:00:00.000Z -> tela: 10/09/2026
```

O navegador manda `"YYYY-MM-DD"` e `new Date(v)` lê isso como meia-noite **UTC**
— 21h do dia anterior no Brasil. Estava em nove pontos, de cinco módulos: fiado,
compras, caixas, embalagens e higienização. O módulo de despesas já tinha a
conversão certa numa função privada, que virou `parseFormDateTz` em `tz.ts`.

**Por que passava batido.** `new Date(input.dueDate)` parece correto em revisão e
erra por 3 horas. Por isso a correção não se sustenta em lembrar do padrão: o
teste cobra `parseFormDateTz` em **todo** `src/lib/services`, com lista de
pendências declaradas — hoje só `vendas.service.ts` (§10).

Commit `9aa6421`.

---

## 5. Dois pagamentos de fiado ao mesmo tempo

Dinheiro recebido continuava aparecendo como dívida do cliente, e a conta nunca
quitava: no extrato havia dois pagamentos, no saldo um só.

`registrarPagamento` lia o `paidAmount`, somava e gravava o total. Em READ
COMMITTED — o padrão do Postgres — duas transações leem o mesmo saldo e a
segunda grava o dela por cima da primeira (*lost update*). Não precisa de azar:
o dono e o funcionário lançando ao mesmo tempo, ou um duplo toque no botão em
rede ruim.

O `paidAmount` lido passou a entrar na condição do `UPDATE`. O Postgres reavalia
o `WHERE` depois de esperar o lock da linha, então o segundo lançamento não casa
e é recusado com mensagem — em dinheiro, recusar e avisar é melhor que somar
errado em silêncio.

Nenhuma fórmula mudou. O teste fixa a invariante (saldo da conta = soma do
extrato) sob 4 pagamentos concorrentes e reprovou em **3 de 3** execuções contra
o código anterior, passando em 4 de 4 com a correção — não é teste instável.

Commit `db93329`.

---

## 6–7. O saldo de caixas plásticas por cliente não era confiável

Três defeitos, um tema: o número de caixas na rua estava errado, e é com ele que
o comerciante cobra devolução.

**6. O painel contava o mesmo cliente uma vez por conta.** Cada venda a prazo
abre uma conta nova, então um freguês com duas compras em aberto entrava duas
vezes no total — o card "Caixas com clientes" mostrava o dobro, errando mais
justamente para quem compra mais. Commit `cbdf3b0`.

**7a. `saldoPorCliente` ignorava o `ESTORNO_SAIDA`**, que o saldo global
desconta. Depois de cancelar uma venda, as caixas continuavam contadas no nome
do cliente: a tela do fiado pedia devolução de caixas que o estorno já havia
trazido de volta, e o formulário aceitava — tirando do estoque caixas que
ninguém devia.

**7b. A guarda de devolução era global.** `RETORNO`, `ESTORNO_SAIDA` e `QUEBRA`
com cliente eram validados contra o total da empresa na rua. Devolver 30 no nome
de quem levou 17 passava, desde que houvesse 30 com outros fregueses. O ledger
daquele cliente ia a negativo — e desaparecia da lista, que filtra `saldo > 0` —
enquanto o estoque de sujas ganhava caixas que não existem fisicamente. A tela
`/caixas-plasticas/novo` não tem limite por cliente e o nome é texto livre: um
nome digitado errado bastava.

O limite passou a ser o saldo do cliente, lido **dentro da transação** por
`registrarInTx` — nenhum chamador precisa lembrar de passá-lo.

Commit `c993d7c`.

---

## 8. Cobrança PIX vencida trancava a tela de pagamento

`getStatus` devolvia como `pendingCharge` qualquer linha `PENDENTE` do mês, sem
olhar a validade. A tela de assinatura esconde o seletor de plano, o formulário
de cartão e o botão de gerar código enquanto existe cobrança pendente — então
quem gerava o PIX e não pagava em 48h voltava e encontrava o **QR morto** com
"Aguardando o pagamento — o acesso libera sozinho".

Como empresa SUSPENSA só alcança `/assinatura`, ela ficava sem **nenhuma** forma
de pagar até o cron do dia seguinte derrubar a linha — e só se o Mercado Pago
devolvesse `cancelled`. Cliente querendo pagar e impedido de pagar.

A regra de "cobrança ainda utilizável" já existia no arquivo (`isUsable`, usada
por `prepareCharge`); faltava valer também para quem lê o status.

Commit `c496f44`.

---

## 9. Pagar o QR antigo, mais barato, liberava o plano novo

Trocar de plano na tela de pagamento marca a cobrança anterior como CANCELADO
**só no nosso banco**: o código PIX antigo continua pagável no Mercado Pago por
48h, porque não existe cancelamento no gateway (`mercadopago.ts` tem apenas
`create*` e `getPayment` — verificado).

Pagando o código antigo — justamente o que já estava copiado no app do banco —
o mês era creditado por inteiro e a assinatura ficava ATIVA no plano **novo**,
mais caro, tendo entrado o valor do **antigo**. `applyPaymentStatus` não
comparava o valor pago com nada: encontrava a linha CANCELADO, escapava das duas
guardas de idempotência e aprovava. Depois disso, a guarda `MENSALIDADE_JA_PAGA`
bloqueava a cobrança correta do mês. Era também o caminho da cobrança em dobro —
pagar no cartão e depois no QR antigo, que segue válido.

Agora o valor que entrou tem de cobrir a mensalidade **devida**. Conferir contra
`payment.amount` não pegaria nada: a linha antiga foi cobrada em 49,90 e foi
49,90 que entrou — quem decide é o valor devido hoje.

A checagem fica **fora** da transação de propósito: abortá-la lá dentro não
desfaria o `updateMany` já aplicado. Deixando a linha intocada, a tela continua
oferecendo o pagamento — o cliente não fica com "já pago neste mês" e sem
acesso, que seria outro beco sem saída — e o valor a menos vai para o log para
um humano resolver.

O fake do gateway devolvia `amount: 0` fixo; passou a guardar o valor cobrado,
como o `transaction_amount` real. Sem isso o teste não representaria nada.

Cancelar de fato no gateway exige método novo em `mercadopago.ts` e fica para
uma mudança própria; esta fecha o prejuízo. Commit `190d18a`.

---

## 10. A rede de segurança do webhook nunca alcançava as cobranças novas

Um único `findMany` com `OR: [PENDENTE, APROVADO]`, `take: 200` e mais antigas
primeiro servia aos dois objetivos da rotina. As APROVADAS são reconsultadas
todos os dias por dois meses e são sempre mais antigas que as pendentes de hoje:
a partir de ~100 empresas pagantes o lote fechava antes de alcançar uma única
pendente.

Isso importa porque a reconciliação é a única rede para webhook perdido — o
webhook responde na hora e processa em `after()`, então uma queda de instância
engole o evento em silêncio. A empresa pagava, o evento se perdia, e ela ficava
SUSPENSA indefinidamente vendo "Aguardando o pagamento", sem nada capaz de
recuperá-la.

Agora são dois lotes com tetos próprios, pendentes primeiro, e a saturação
aparece em log — o retorno `{ verificados, atualizados }` não distinguia "nada a
fazer" de "lote estourado".

Commit `43e8271`.

---

## 11. Link de confirmação expirado era beco sem saída

O token vale 24h. Quem abrisse o e-mail no dia seguinte — ou não recebesse na
hora, porque o envio falha em silêncio — perdia os 7 dias de teste de forma
definitiva.

A mensagem mandava "faça o cadastro de novo para receber outro", e isso é
**comprovadamente inócuo**: `register` vê o e-mail em uso, não cria nada, não
reemite token, e o único e-mail que sai é o de "conta já existente". Não existia
reenvio em lugar nenhum do app — `verifyTokenHash` só era escrito no cadastro.
Entrando pelo login, que não exige e-mail confirmado, a pessoa lia "falta o
pagamento da primeira mensalidade": empurrada a pagar um mês que devia ser de
teste. Só quem usava e-mail do Google escapava.

O próprio clique no link expirado passou a reemitir e avisar. Dois cuidados:

- O e-mail é enviado **antes** de gravar o token novo. Gravando primeiro, uma
  falha de SMTP mataria o link antigo sem entregar o novo — beco sem saída pior
  que o original. Nesta ordem, a falha deixa o token antigo intacto e clicar no
  mesmo link tenta de novo; a mensagem diz isso.
- O token novo substitui o antigo, então o mesmo link não dispara um segundo
  e-mail: um reenvio por link expirado, não um por clique.

Commit `2bfd99a`.

---

## 12. "Seu teste grátis terminou" no primeiro dia do teste

A tela de bloqueio decidia o texto por campo cru: `trialEndsAt !== null` era
lido como "o teste terminou". Só que quem acaba de confirmar o e-mail recebe
essa data no **futuro**.

E dá para chegar na tela de bloqueio exatamente nesse estado: a tela de sucesso
do cadastro oferece "Ir para o login", o login não exige e-mail confirmado —
então muita gente entra **antes** de clicar no link. A confirmação grava o trial
no banco e não reemite o cookie, e o proxy decide pelo token. A pessoa clicava
em "Entrar no CeasaPro", caía em `/conta/suspensa` e lia "Seu teste grátis
terminou. Escolha um plano e pague" no primeiro dia dos 7 — logo depois de a
tela anterior anunciar que os dias começaram.

A decisão saiu do campo cru e virou `motivoDoBloqueio`, pelas datas, com teste
próprio (mesma razão de `situacaoCobranca` existir). O caso novo, `teste_ativo`,
diz o que aconteceu — é sessão velha, não cobrança — e oferece entrar, não
pagar. E o botão da tela de confirmação passa pela renovação em vez de ir ao
`/login`, então o cookie é reemitido a partir do banco.

Commit `51db9fc`.

---

## 13. CNPJ em branco ocupava o índice único

`Tenant.cnpj` é `@unique` e **global**: NULL repete à vontade, string vazia não.
O campo é opcional na tela, o formulário manda `""`, e `input.cnpj ?? null` só
troca null/undefined.

A primeira empresa salva sem CNPJ ocupava a vaga e, da segunda em diante, a
gravação falhava com "Ocorreu um erro inesperado", de forma determinística.
Atingia os dois lados — o cadastro pelo super-admin e, pior, a tela do cliente
em Configurações → Empresa, pré-carregada com `cnpj: ""`. O primeiro box que
salvasse sem preencher o CNPJ deixava todos os outros sem conseguir salvar os
dados da própria empresa, para sempre.

Três frentes, uma causa: `cnpjSchema` converte vazio em `null` na borda (cobrindo
os três pontos de escrita), `deleteTenant` solta o CNPJ como já fazia com o
e-mail e o `googleSub`, e a colisão real passa a ser erro de negócio com
mensagem nas duas telas.

Commit `0858dda`.

---

## 14–15. Painel do super-admin contava o que não existe

**14.** No mesmo `Promise.all` de `metrics`, o cartão "Empresas" filtrava
`deletedAt` e o MRR e o `groupBy` de status não. Depois de um churn a tela se
contradizia (Empresas 8, Ativas 11) e o MRR — número pelo qual se decide preço e
caixa — ficava inflado. Não era transitório: `deleteTenant` não encerra a
assinatura e `recomputeStatuses` varria todas sem filtrar, então o cron movia a
assinatura órfã para VENCIDO/SUSPENSO e ela engordava "Inadimplentes" para
sempre, mandando cobrar quem não existe mais. Verificado que o lembrete por
e-mail já filtrava `deletedAt`: ninguém recebia cobrança indevida.
Commit `9f94b18`.

**15.** `listUsers` corta em 200 com ordem "ativo primeiro", e a tela contava os
cartões sobre esse conjunto. Como os desativados ficam no fim da ordenação, eram
exatamente eles os cortados: passando de 200 usuários com acesso, "Sem acesso"
marcava 0 e o filtro respondia "nenhum usuário encontrado". O super-admin
concluía que não havia ninguém bloqueado olhando uma tela que só viu os 200
primeiros nomes. Os totais passaram a sair do conjunto inteiro, reusando o mesmo
`situacaoCobranca` das linhas, e a truncagem virou dado explícito.
Commit `533fea7`.

---

## 16–17. Higienização

**16. Lançamentos simultâneos perdiam um.** Devolução e pagamento eram
ler-somar-escrever. No pagamento, dinheiro entregue ao higienizador ficava fora
da conta. Na devolução era pior: o lote registrava menos caixas devolvidas do
que os movimentos do ledger, e a guarda de "faltam N caixas" passava a recusar o
resto — o envio ficava travado num pendente que ninguém mais conseguia quitar,
com as caixas já de volta no box. Mesmo compare-and-set do fiado; reprovou em 3
de 3 execuções contra o código anterior. Commit `5ab11af`.

**17. Editar envio com perda registrada deixava o saldo negativo.**
`registrarPerda` grava a QUEBRA e atualiza só o `status` — nunca `returnedQty`
nem `paidAmount` —, mas a guarda de edição olhava apenas esses dois campos.
Reduzir a quantidade enviada nesse estado encurtava a `SAIDA_HIGIENIZACAO`
abaixo do que já saiu: o painel mostrava "Em higienização" **negativo** e o
estoque de sujas ganhava caixas fantasma — que o próprio painel manda
higienizar. O dono levava ao higienizador caixas quebradas que não existem mais.
Um usuário só, dois cliques. O `remove` do mesmo serviço já fazia a checagem, e o
comentário do ramo afirmava que a guarda garantia isso — não garantia.
Commit `1c9ed21`.

---

## 18–19. "Replicar mês anterior"

O atalho existe para o dono do box não redigitar as 8–10 contas fixas no dia 1º.

**18. A tela mandava o mês errado.** Recebia `resumo.referencia` — o mês
**corrente** — como origem. No dia 1º, com a lista vazia, respondia "não há
despesas com vencimento em <mês corrente> para replicar", e não havia caminho na
tela para pedir o mês passado. Com o mês já preenchido, criava as contas do mês
**seguinte**: um mês adiantadas, invisíveis nos cartões, com o toast dizendo que
copiou. O default certo existia no serviço e ficava morto.

**19. Replicar matava a recorrência.** `gerarProximaParcela` usa a existência de
um filho com `parentId` como marca de "já gerei a parcela seguinte", e
`replicarMes` gravava `parentId` nas cópias manuais. Replicar um mês que
contivesse o aluguel recorrente ainda em aberto fazia a quitação encontrar a
**cópia**, concluir que o trabalho estava feito e apagar o `recurring` da
origem: a conta "Todo mês" parava de se repetir para sempre, sem erro e sem
aviso, e o dono só descobria quando ela não estava na lista.

A correção é não copiar conta que já se repete sozinha — ela gera a própria
parcela ao ser quitada. Isso também evita o outro estrago da mesma origem: duas
contas iguais no mês seguinte, a cópia e a parcela.

Commit `68e2ab8`.

---

## 20–21. Painel: dois números que decidem preço

**20. Teto errado nas despesas.** A janela do mês terminava em "até agora". A
conta fixa que vence dia 20 é despesa deste mês desde o dia 1º, então no dia 8 o
painel dizia "Contas fixas R$ 0,00" e um "Sobrou no mês" R$ 5.000 acima do real,
enquanto `/despesas` mostrava "Fixas R$ 5.000,00" no mesmo instante — e o lucro
ia "piorando" conforme os vencimentos chegavam, sem nada acontecer.

O comentário no código dizia que o teto existia para fechar com
`DespesasService.resumoMes`; era o contrário — `resumoMes` usa o mês inteiro.
Agora a despesa termina no fim do mês, o que preserva a correção original (a
parcela de outubro continua fora de setembro). Venda e compra seguem com teto
"até agora": data futura não é faturamento realizado.

**21. "Contas do mês" não era do mês.** O agregado não tinha filtro de data e
somava todo pendente de qualquer mês. O rótulo dizia mês e a consulta dizia
histórico, então "Contas fixas" + "Contas variáveis" não fechavam com o card
logo acima deles. Passa a usar a mesma janela de `resumoMes.aPagar`.

Nenhuma fórmula mudou — o que mudou é quais linhas entram na conta.
Commit `c498255`.

---

## 22. Aviso de higienização ignorava o plano

A empresa que saiu do plano com Higienização continuava vendo "Higienização a
pagar" no topo do painel, e tocar levava a `/plano?bloqueado=higienizacao`. No
push era pior: a notificação diária pode ser exatamente essa, e o toque caía no
paywall — o oposto do que o serviço de push se propõe.

O serviço vizinho já tratava disso e documentava o motivo, e o painel chamava um
COM módulos e o outro sem, em linhas consecutivas. No cron não há sessão, então
os módulos vêm do plano da assinatura.

Commit `3810824`.

---

## 23. Refinar dentro de "Vencidas" respondia outra pergunta

A aba Vencidas existe para responder "o que está atrasado?" e é o destino dos
avisos e do push — ou seja, é justamente onde alguém chega para refinar. Ao
buscar "luz" ou escolher uma categoria, o componente reconstruía a URL apenas
com `status=PENDENTE` e o recorte de atraso ia embora. Não dá erro: a lista passa
a mostrar todas as pendentes, inclusive as que vencem no futuro. O dono lê aquilo
como "meus atrasados de Aluguel" e liga para o fornecedor por uma conta que ainda
não venceu.

A troca de **aba** já preservava os filtros de propósito; faltava o sentido
inverso. A construção da URL saiu do componente para um módulo puro, porque é
ali que o recorte se perde.

Commit `9275e93`.

---

## 24. A suíte não sobrevivia a si mesma

`plans` é global, `cleanupTenants` não a limpa e cada arquivo apaga só os planos
que criou. Quando a suíte quebra no meio — foi o que aconteceu com o banco de
verificação sem a migração do login Google — o `afterAll` não roda e sobram
planos ativos de R$ 29,90 na base. O teste "entra no plano mais barato" passava a
falhar **para sempre** naquele banco: verde no CI (banco novo a cada execução) e
vermelho na máquina de quem roda `npm run test` duas vezes, com cara de bug de
billing. O plano do teste agora custa um centavo, abaixo de qualquer resíduo
plausível. Commit `5a37f7d`.

---

## 25. "Sair" sem internet não fazia nada

`encerrarSessao` começava com `await fetch("/api/auth/logout")` sem `try`. No box
com sinal ruim — o cenário para o qual o PWA existe — o fetch rejeita (o service
worker não intercepta POST) e o resto da função nunca rodava: nem a limpeza do
snapshot, nem a navegação.

Como os quatro botões usavam `void encerrarSessao()` e o projeto não tem handler
de `unhandledrejection`, a rejeição morria em silêncio. A pessoa tocava em
"Sair", a tela não mudava, nenhuma mensagem aparecia — e ela ia embora achando
que tinha saído, com o snapshot de consulta ainda no aparelho: estoque, nomes
dos clientes e quanto cada um deve, legível em `/consulta-offline` **sem
sessão**. Num celular compartilhado entre dois boxes, é o movimento da empresa
que fica para o próximo que abre o app.

Agora o dado local sai sempre e a falha é dita. Sem rede a função não navega de
propósito: o cookie é httpOnly e continua válido, então ir para `/login` faria o
proxy devolver a pessoa ao sistema — com cara de botão quebrado.

Commit `c34aa00`.

---

## 26–27. Push: dono anterior do aparelho e quem perdeu o acesso

A inscrição de push é por ORIGEM (aparelho), não por usuário, e o logout não a
cancela.

**26.** Depois que A sai e B entra no mesmo celular, `getSubscription()` devolve
a MESMA inscrição e a linha no banco continua apontando para A: as notificações
diárias que chegam ali são as da empresa de A, com o movimento no corpo ("3
cliente(s) com fiado vencido"). Pior para B, a tela mostrava "inscrito" e só
oferecia "Desativar" — ele nunca via "Ativar" e não tinha como fazer os avisos da
própria empresa funcionarem. O servidor já resolvia isso (o upsert por endpoint
REATRIBUI o dono, com o caso do celular compartilhado escrito no comentário); só
que ninguém chamava. Agora o carregamento reafirma o dono.

**27.** O cron listava inscrições sem filtrar usuário vivo, e nem
`desativarUsuario` nem as exclusões apagam a inscrição — o admin nunca toca em
`pushSubscription`. O bloqueio da EMPRESA já era checado; o do usuário, não.
Filtrar na consulta também cura as linhas que a base já tem órfãs.

Commit `e2496d8`.

---

## 28. O relatório repetia o defeito que a tela já tinha corrigido

O rodapé de "A devolver" somava linha a linha, e a linha é por conta enquanto o
saldo de caixas é por cliente: o freguês com duas compras em aberto entrava duas
vezes. É o mesmo defeito do §6, na tela — o relatório ficou de fora, e é ele que
o comerciante leva para cobrar devolução.

Vale registrar como apareceu: foi o lote 4 que o achou, **depois** de eu ter
corrigido a tela no lote 1. Revisar por módulo não alcança o mesmo cálculo
repetido em outro lugar — é o argumento para o teste de invariante em vez da
correção pontual.

---

## 29. Pagamento parcelado ao higienizador saía no dia errado

`crate_cleanings.paidAmount` é ACUMULADO e `paidDate` guarda só a data do ÚLTIMO
pagamento, e o fluxo de caixa somava esses dois campos. Pagar em duas vezes
fazia o dia do primeiro pagamento aparecer sem despesa nenhuma e o dia do último
com o valor cheio do lote. Se o último caía fora do período, o lote inteiro
desaparecia e o mês fechava com saída menor que a real — lucro inflado, no
número que vai para o contador.

Não havia como corrigir só a consulta: com um acumulado e uma data, quanto saiu
em cada dia é indeterminável. Cada pagamento passou a ter linha própria em
`crate_cleaning_payments`, mesmo desenho de `credit_payments`, gravada na mesma
transação. A migração faz backfill de uma parcela por lote — não recupera o
parcelamento antigo, que é impossível a partir do que foi guardado, mas mantém o
total em vez de zerar o passado.

Commit `e024cb9`.

---

## 30. Quatro relatórios pagos ficavam liberados em qualquer plano

`isAdvancedReport` decidia pela PRESENÇA numa lista de avançados — fail-open — e
quatro relatórios nunca foram classificados: "Lucro por fornecedor", "Produtos
com prejuízo", "Estoque parado" e "Total de caixas de papelão". Os dois gates
dependem só dessa função, então eles apareciam na lista para quem está no plano
básico E a rota de exportação gerava o Excel/PDF sem pedir módulo. O de papelão
ainda entregava dados de `packaging_sales`, que é de outro módulo.

Agora decide pela AUSÊNCIA em `BASIC_REPORTS`: esquecer de classificar um
relatório novo o deixa BLOQUEADO — alguém reclama e conserta — em vez de
liberado em silêncio.

Com a classificação certa, dois grupos ficaram inteiramente pagos e um teste
antigo reprovou: "todo grupo tem ao menos um relatório do plano básico". Ele
estava sendo satisfeito **pelo próprio defeito** — o grupo de caixas cumpria a
regra graças ao relatório mal classificado. A regra não se sustenta: a tela não
abre seção vazia, mostra o cartão "+ N relatório(s) em outro plano". A decisão e
o motivo ficaram escritos no teste. Commit `aafd64d`.

---

## 31. O onboarding apagava dados já cadastrados

`ConfigService.updateCompany` grava os seis campos da empresa de uma vez — não
existe "não mexer neste": o que a tela não mandar vira `null`. E o passo 1
mandava `legalName: null, cnpj: null, businessHours: null` fixos, com telefone e
endereço partindo de string vazia, porque a página só buscava o nome.

Perda silenciosa em todo cliente novo, no primeiro clique em "Continuar": o
telefone é OBRIGATÓRIO no cadastro público e é o único contato do box; a empresa
criada pelo admin já vem com CNPJ e razão social digitados pelo suporte. A tela
ainda dizia "Confirme os dados da sua empresa" mostrando o telefone em branco —
quem confiou no que viu confirmou o apagamento.

Commit `5259742`.

---

## 32–34. Promessas que a tela não cumpria, e um teste que não olhava

**32.** Quem nunca pagou tem `currentPeriodEnd` no passado — é a data do
cadastro. A aba Assinatura mostrava "Mensalidade R$ X" e "Vencimento <data já
passada>" durante todo o teste grátis, contradizendo a faixa do topo ("seu teste
termina em N dias") justamente na janela em que o cliente decide se fica. A tela
de `/assinatura` já se protegia; agora as duas concordam.

**33.** O último passo do tour dizia que o guia de uso "abre sem internet". Não
abre: o service worker não pré-cacheia `/ajuda`. A instrução mandava o
comerciante contar com o guia exatamente quando a conexão cai no box. O texto
passou a apontar onde o guia realmente está. Commit `d0ebda8`.

**34.** Os testes de layout selecionavam o cartão pela classe `bg-card`, e o
tailwind-merge REMOVE essa classe quando quem chama passa outro fundo — o que
acontece na despesa vencida, nas caixas perdidas e no aviso da ajuda. A
varredura de vazamento em 320px ignorava em silêncio justamente os cartões de
destaque, os mais cheios de texto. `Card` passou a expor `data-slot="card"`, que
o estilo não apaga. Com mais cartões no alcance, a varredura segue limpa.
Commit `8880343`.

---

## Pendências declaradas

**PDV congelado.** `vendas.service.ts` tem o mesmo defeito de fuso do §4 em dois
pontos (`saleDate`, `dueDate`). Não foi tocado. A pendência está **declarada no
teste** (`tests/unit/timezone.test.ts`), com motivo, e o teste cobra que ela
continue existindo — resolver a pendência obriga a remover o nome da lista, para
que a lista não vire folclore.

**Cancelar a cobrança no gateway.** O §9 fecha o prejuízo conferindo o valor
devido, mas o QR antigo continua pagável no Mercado Pago por 48h. Cancelar de
fato exige um método novo em `mercadopago.ts` e é uma mudança própria.

**O guia de uso offline.** O §33 tirou a promessa. Cumpri-la é possível — o guia
é conteúdo estático — mas exige pré-cachear `/ajuda` no service worker com bump
do nome do cache: mudança própria, com risco próprio.

---

## Decisão de produto, não defeito

**Teste grátis repetível com variações do mesmo e-mail do Gmail.** O e-mail é
normalizado (`trim` + `toLowerCase`) mas não canonicalizado: `a.b@gmail.com`,
`ab@gmail.com` e `a+x@gmail.com` são a mesma caixa para o Gmail e contas
diferentes para o CeasaPro, então dá para repetir os 7 dias indefinidamente.

Não corrigi de propósito. Canonicalizar mudaria a semântica de login para todo
mundo e é regra específica de um provedor: alguém que usa `+tag` legitimamente
para separar dois boxes passaria a colidir. O custo do abuso é 7 dias por
tentativa, e cada tentativa perde os dados anteriores. É uma escolha de produto
— vale decidir explicitamente, não por omissão do código.

---

## Verificação

| Etapa | Resultado |
|---|---|
| `prisma validate` | verde |
| `lint --max-warnings=0` | verde |
| `typecheck` | verde |
| Testes (unit + integração) | **85 arquivos, 986 testes** verdes |
| `build` | verde |
| E2E | **99 passando**, 2 pulados, 0 falhando |

Cada correção foi validada dos dois lados: rodando o teste novo contra o código
antigo (tem de reprovar) e contra o novo (tem de passar). Os dois testes de
concorrência foram repetidos 3× reprovando e 4× passando, para não entrar na
suíte um teste instável.

**Três achados foram descartados por medição, não por opinião:** custo médio
ponderado, valor de estoque com produto excluído e ajuste sem conferir saldo
foram reportados pelos agentes, mas já estavam corrigidos pelo commit `356a65d`
— os agentes leram a árvore antes do merge. Conferi cada um no código atual
antes de mexer.
