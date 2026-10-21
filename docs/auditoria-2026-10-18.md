# Auditoria de ponta a ponta — 2026-10-18

Terceira rodada, cobrindo **todos os módulos e todas as entradas** do sistema, com as mudanças ainda não commitadas da regra única de desfazer (cancelar compra, estornar recebimento, cancelar venda pelo fiado, guardas de exclusão, embalagem no faturamento, higienização pela data de envio).

## Como foi feita

Foram sete frentes em paralelo, só leitura, cada uma com o briefing (`CONTEXTO-AGENTE.md`) e a instrução de confirmar no código antes de reportar:

1. autenticação, sessão e proxy;
2. cobrança, planos e módulos;
3. isolamento entre empresas e controle de acesso (todas as actions, rotas e SQL cru);
4. balcão: produtos, compras, estoque, PDV e fiado;
5. números do dono: Início, despesas, relatórios e snapshot offline;
6. caixas, higienização e embalagens;
7. cotações, CeasaNews, fotos, super-admin e PWA.

Os achados de maior impacto foram reconferidos à mão. Também rodei `npm audit` e conferi que nenhum segredo está versionado.

- **Base depois das correções desta rodada:** unit 1302/1302, componentes 102/102, integração 849/849, `tsc` e `eslint` limpos.

## Resultado geral

- **Nenhum vazamento entre empresas.** Os 70 Server Actions e todas as rotas de negócio passam pelos envelopes. Nenhum aceita `tenantId`, `userId` ou `role` do corpo. Todo SQL cru filtra `tenantId` na tabela-raiz, e não há `$queryRawUnsafe` com dado do usuário.
- **Nenhum bypass de autenticação.** JWT com `aud`/`iss`/`alg` fixos. Cookies `httpOnly`/`Secure`/`Lax`. PKCE + state no Google. Redirect aberto bloqueado. Revogação por epoch nos wrappers. Webhook com HMAC em tempo constante e anti-replay. Cron com `timingSafeEqual`.
- **Nenhum XSS nem cache de dado autenticado no PWA.** O CeasaNews é texto puro e só aceita imagem `https`. O service worker só guarda assets e as páginas offline.
- **Dependências:** 0 vulnerabilidades nas de produção. Há 5 "high" só nas de desenvolvimento (cadeia do ESLint/micromatch), que não vão para o servidor.
- **Segredos:** só `.env.example` está no git; `.env*` e `.env.prod-fotos` estão ignorados.

---

## 1. Corrigido nesta rodada (defeitos nas mudanças não commitadas)

| # | O quê | Correção |
|---|---|---|
| C1 | **Devolução da venda cancelada "pela média da hora" inflava o estoque.** Comprou 10 a R$ 10, vendeu as 10, comprou 10 a R$ 20, cancelou: valia R$ 400, quando custou R$ 300. | Volta pelo `unitCostAtSale`, que é o custo daquela mercadoria. Os testes voltaram aos valores certos (58,5714 e 15,00). |
| C2 | **Cancelar compra com estoque anterior deixava CMV errado.** Com 10 a R$ 5 em estoque, compra errada de 10 a R$ 500; vender 5 grava R$ 252,50 de custo. O cancelamento passava (saldo 15 ≥ 10) e a venda ficava com R$ 1.237,50 de CMV a mais para sempre. | Recusa se houve **qualquer saída ou ajuste** dos produtos depois da compra. Compra seguinte não impede. |
| C3 | **A tela mandava estornar recebimento de venda já fora do prazo.** O dono estornava um pagamento real e depois ouvia "passou o prazo". | O serviço confere o prazo antes do recebimento. As telas do fiado e da venda só sugerem estorno dentro do prazo. |
| C4 | **Cancelar venda depois de excluir o produto punha estoque num produto invisível.** | A exclusão de produto recusa enquanto houver venda dele ainda cancelável (24 h). |
| C5 | **Estorno de caixas da compra datado de hoje.** O relatório de setembro mostrava +30 caixas e o de outubro −30. A tela mostrava "Entrada −30". | O estorno leva a data da entrada. Tela e relatório mostram "Estorno de entrada". |
| C6 | **"Pagamentos (N)" contava os estornados.** | Conta só os vivos. |
| C7 | **Total da compra 1 centavo diferente da soma dos itens** (pré-existente). | Total = soma das linhas já arredondadas + frete, como na venda. |

Testes novos: `desfazer-lancamentos.test.ts` (C2, C4, C7, compra seguinte) e `fiado-crud.test.ts` (C3). `estoque-custo-ajuste.test.ts` cobre C1.

---

## 2. Prioridade alta/média — **todos corrigidos em 19/10** (ver §2a)

Nenhum era vazamento entre empresas. A tabela fica como registro do achado.

| # | Área | Achado | Onde | Sugestão |
|---|---|---|---|---|
| P1 | Cobrança | **A tolerância sai de graça todo mês.** Quem paga no 5º dia de `VENCIDO` recomeça o ciclo na data do pagamento (vence 01/10, paga 06/10, próximo 06/11). Durante `VENCIDO`, a troca de plano também é imediata: dá para subir para o plano completo, usar e voltar antes de pagar. | `billing.service.ts:1159`, `plano.service.ts:361-363` | Ancorar o novo período em `currentPeriodEnd` enquanto o atraso for menor que um mês. Agendar a troca também em `VENCIDO`. |
| P2 | Cobrança | **Reajuste do admin não derruba o QR já emitido.** O cliente paga o valor velho, cai em `VALOR_MENOR`, o mês não é creditado e o dinheiro fica parado. | `admin.service.ts:569` (`updateMonthlyAmount`) | `travarAssinatura` + baixar e cancelar pendentes, como `changePlan`. |
| P3 | Cobrança | **Estorno suspende com período pago em curso.** Se a competência corrente já está paga, a tela recusa cobrar (`MENSALIDADE_JA_PAGA`) e o cliente fica bloqueado sem como pagar. | `billing.service.ts:1207-1250`, `competenciaACobrar` `:184-200` | Decidir o status pelo período que restou. Liberar a cobrança da competência estornada. |
| P4 | Auth | **Dá para trancar o login de qualquer conta.** 21 tentativas por 15 min no contador por e-mail, de um IP só; nem redefinir a senha destrava. O "esqueci a senha" pode ser esgotado em silêncio (3 por 15 min). | `api/auth/login/route.ts:53-64`, `api/auth/forgot/route.ts:41-52` | Contar por e-mail só quando o limite por IP não estourou. Liberar a janela de e-mail ao redefinir a senha. Avisar na tela de recuperação quando o limite estourou. |
| P5 | Caixas | **Soma do livro-razão em `::int` sem teto de quantidade.** Um número colado errado (1.500.000.000 × 2) estoura e trava o módulo inteiro, inclusive o cancelamento que corrigiria. | `caixas.service.ts:253-265, 349-353`; `validations/caixa.ts:21`, `compra.ts:26,30`, `higienizacao.ts:6` | `QTD_MAX` nos schemas e `::bigint`, como já é nas embalagens. |
| P6 | Cotações | **"Remover vínculo" não dura.** `autoVincularIdenticos` recria o vínculo de nome idêntico ao recarregar a tela e a cada produto novo. Contraria o briefing ("nunca gravado sozinho"). Também roda consulta do boletim no cadastro de produto de quem não tem o módulo. | `cotacoes.service.ts:1251-1306`, chamado em `:389`, `:576` e `produtos.service.ts:143` | Guardar a recusa (vínculo "desfeito pelo dono") ou voltar à pré-marcação sem gravar. Gate de módulo no cadastro. |
| P7 | Push | **Inscrição aceita qualquer URL `https`, sem limite.** Isso é SSRF cego pelo cron diário, e muitos endpoints lentos atrasam os avisos de todas as empresas. | `validations/push.ts:3-19`, `push-inscricao.service.ts:32`, `pwa/push-server.ts:77-89` | Lista de hosts de push (FCM, Mozilla, Apple, WNS) e ~10 inscrições por usuário. |
| P8 | Números | **/despesas ignora despesa sem vencimento em Fixas/Variáveis.** O Início e o relatório usam `COALESCE(dueDate, createdAt)`. | `despesas.service.ts:726-735` (`resumoMes`) | Mesma regra de data. |
| P9 | Números | **"Contas a pagar" offline ≠ "Tudo a pagar" do Início.** O offline soma só o mês; o Início inclui atrasadas e futuras. | `dashboard.service.ts:171-176` → `api/pwa/snapshot` | Snapshot ler `ContasPagarService`. |
| P10 | Módulos | **Relatórios de caixas, higienização, embalagens e papelão exigem só `relatorios_avancados`,** não o módulo dono (§3.7). | `api/reports/[type]/export/route.ts:36`, `relatorios/[tipo]/page.tsx:47`, `relatorios/page.tsx:29` | Mapa relatório → módulo, conferido no servidor. |
| P11 | CeasaNews | **A primeira coleta não tem trava e roda no render.** Com os feeds falhando, cada abertura da tela espera até 20 s e cria um `NOTICIAS_FALHA` novo. | `noticias.service.ts:247-253`, `ceasanews/page.tsx:42` | Usar `pegarTravaDeColeta`. Não repetir o aviso aberto. |
| P12 | Cobrança | **Rótulo da competência desalinhado do período pago.** Quem pagou em 15/09 vê o formulário de pagamento de 01/10 a 11/10. | `billing.service.ts:184-200`, `assinatura/page.tsx:29` | Decidir "já pago" pelo período, não pelo mês do calendário. |

## 2a. Correções de 19/10

| # | O que mudou |
|---|---|
| P1 | `inicioDoPeriodoPago` (`billing/status.ts`): pago dentro da tolerância, o mês novo começa no vencimento; depois de ficar sem acesso, hoje. **Resíduo aberto:** a troca de plano em `VENCIDO` continua imediata — quem desce de plano na tolerância usa o plano caro por até `graceDays` dias. |
| P2 | `updateMonthlyAmount` trava a assinatura, baixa os QRs de outro valor e os cancela no MP depois do commit (exceto com troca agendada, que cobra o preço do plano novo). |
| P3 | Estorno (não chargeback) com outro período pago correndo só recua o vencimento, sem bloquear nem revogar sessão. Chargeback bloqueia sempre. |
| P4 | Login e recuperação: o contador por e-mail só recebe a tentativa que passou nos de IP; recuperação passou a ter limite por IP+e-mail (3) e por e-mail (10); redefinir a senha zera o limite de login (`chaveDeLoginPorEmail`). |
| P5 | Somas de caixas em `::bigint`, e teto `CAIXAS_MAX` (100 mil) em todo campo de quantidade de caixas (movimento, compra, venda, fiado, higienização). |
| P6 | `TenantCeasaLinkRecusa` (migration `recusa_de_vinculo_de_cotacao`): remover o vínculo marca a recusa e o automático a respeita; vincular à mão apaga a marca. O cadastro de produto só roda o vínculo automático com o módulo `cotacoes`. |
| P7 | `ehServicoDePush`: só hosts de FCM, Mozilla, WNS e Apple (https, porta padrão); no máximo 10 inscrições por pessoa (as antigas saem). |
| P8 | `resumoMes` usa vencimento ou, sem ele, a data do lançamento (`pelaDataDaConta`) — a mesma regra do Início. |
| P9 | O snapshot offline lê "a pagar" de `ContasPagarService` — o mesmo número do Início. |
| P10 | `MODULO_DO_RELATORIO` / `modulosDoRelatorio`: página, exportação e lista exigem o módulo dono; relatório de módulo que a empresa não tem nem aparece. |
| P11 | Primeira coleta do CeasaNews com a trava de sempre e intervalo de 10 min entre tentativas sem sucesso; `NOTICIAS_FALHA` não se repete enquanto houver um não lido. |
| P12 | `competenciaACobrar`: período pago correndo (um APROVADO com `periodEnd` futuro) e fora da janela é "já pago", qualquer que seja o rótulo do mês. |
| baixa | Dinheiro com no máximo 2 casas também em higienização e embalagens (`temAteDuasCasas`). |

## 2b. Correções de 21/10

| Item | O que mudou |
|---|---|
| PIX de outra competência | Gerar cobrança (PIX ou cartão) e aprovar pagamento baixam e cancelam no MP as pendentes de **todas** as competências. |
| `replicarMes` sem trava | Transação com `pg_advisory_xact_lock(hashtext(tenantId), 5)`. |
| "Usar o sistema" com duplo clique | Linha do usuário travada (`FOR UPDATE`) e plano interno por `upsert`. |
| Super-admin redefinindo senha de super-admin | Recusado no serviço; botão desabilitado. |
| Super-admin sem desfazer no próprio ambiente | `podeDesfazer` (OWNER ou SUPER_ADMIN — a sessão dele só tem o tenant do ambiente). |
| Gráfico 6 meses × Resultado do mês | "Vendas" = faturamento (com embalagem) e "Contas" com higienização enviada, por módulo. |
| Relatório "Contas pagas" × cartão "Pagas" | Inclui os pagamentos ao higienizador (com o módulo). |
| Boletim colado "1.200" | Ponto seguido de exatamente 3 dígitos, sem vírgula, é milhar. |
| Corrida em `emailIdentity` | Índice único parcial `users_email_identity_ativa`; colisão = "já tem conta". |
| Corrida na rotação do refresh | Rotação e uso da graça reivindicados por update condicional. |
| Route Handlers sem `Origin`/`Content-Type` | `assertMesmaOrigem` nos envelopes de rota (403/415). |
| Upload de foto sem limite | 100/empresa/dia; órfãs com mais de 24 h apagadas pelo cron. |
| Fiado incobrável (§4) | **Baixar como perda** — decisão do dono: perda no resultado do mês da baixa. |
| Embalagem sem custo (§4) | **Custo médio** gravado na venda; entrada e saldo inicial exigem custo. |
| Venda de embalagem apagada a qualquer tempo | Agora é **cancelada** (até 24 h, marcada, estoque volta por AJUSTE de estorno). |
| Fiado baixado sem saída para o pagamento tardio | Recebimento depois da baixa (`aposBaixa`) entra no resultado do mês em que chega. |
| Observabilidade | Sentry integrado (desligado sem DSN; source maps com `SENTRY_AUTH_TOKEN`); monitor externo e restauração de backup documentados em `09-deploy-vercel.md`. |

## 2c. Quarta rodada (21/10) — revisão em quatro frentes e correções

Cobrança, segurança, fluxo do balcão e consistência dos números, revisados em paralelo e conferidos no código antes de corrigir.

| # | Problema | Correção |
|---|---|---|
| 1 | Quebra, doação e ajuste negativo nunca descontavam do lucro (o CMV só via o vendido). | `perdasEstoqueMes` em `FinancialCalc.custoDoVendido`, pela data e custo do movimento; linha "Perdas e acertos de estoque". |
| 2 | Compra de embalagem contava duas vezes (conta manual + custo médio) ou sumia do caixa. | Entrada com custo gera conta `COMPRA_EMBALAGEM` (fora do lucro, dentro do caixa); desfazer em 24 h. |
| 3 | Teste de cartão roubado pelo checkout (sem e-mail confirmado, limite só em memória). | Cartão exige e-mail confirmado; 5/h por empresa e 10/h por IP no Postgres. |
| 4 | Recálculo de status gravava por cima de chargeback (VENCIDO + MANUAL = acesso eterno). | `gravarStatusCalculado` condicional em `updatedAt` (cron e login). |
| 5 | Corridas no fiado baixado (estorno × baixa; desfazer baixa × recebimento). | `status`/`paidAmount` nas condições dos `updateMany`. |
| 6 | Higienização editável/excluível a qualquer tempo, apagando movimentos de caixa. | 24 h + `ESTORNO_SAIDA_HIGIENIZACAO` (volta às sujas). |
| 7 | Recorrente de dia 31 escorregava para 28 para sempre. | `diaAncoraDaCadeia` + `proximoVencimento(data, diaAncora)`. |
| 8 | Chargeback ignorava o pagamento DUPLICADO do mesmo mês. | A reversão promove o duplicado a pagador do mês. |
| 9 | Backup de produção em claro dentro do OneDrive. | Criptografado (AES-256 + HMAC, senha própria) em `C:\Backups\CeasaPro`; OneDrive recusado. |
| 10 | Login/logout CSRF (rotas de auth fora do envelope). | `recusaDeOutraOrigem` em todas as rotas POST de `/api/auth`. |
| 11 | Recebimento de fiado e fiado manual sem idempotência. | `idempotencyKey` (índice único) nos dois. |
| 12 | Quantidade/preço sem limite de casas nem teto. | `src/lib/validations/quantidade.ts`. |
| 13 | Ajuste manual sem desfazer (custo errado contaminava a média). | `desfazerAjuste` (24 h, par fora do repasse). |
| 14 | Embalagem sem custo virava lucro sem aviso. | Aviso no "Resultado do mês". |
| 15 | Três "vendas" diferentes na aba Financeiro; categorias sem higienização. | Fatias "Higienização" e "Venda de embalagem"; rótulos ajustados. |
| 16 | Perda com fiado e custo de embalagem fora dos relatórios. | `FIADO_PERDAS`; custo/lucro em `EMBALAGENS`. |
| 17 | "Contas pagas" × fluxo de caixa para quem saiu do módulo de higienização. | Pago ao higienizador conta sempre. |
| 18 | Custo de embalagem fora do `FinancialCalc` (1 centavo). | `ROUND(..., 2)` por venda, como `custoVendaEmbalagem`. |
| 19 | Estorno de caixas da venda cancelada com a data de hoje. | Data da venda. |
| 20 | Aprovação pelo relógio do processamento. | `mp.paidAt` limitado a agora. |
| 21 | Pagamento acima do devido creditado em silêncio. | Aviso `PAGAMENTO_ACIMA_DO_DEVIDO`. |
| 22 | Token de redefinição de senha na URL podia ir ao Sentry. | `beforeSend`/`beforeBreadcrumb` trocam por `:token`; erro do Prisma vai sem a mensagem. |
| 23 | Logout não derrubava o access (15 min). | Claim `fid` + linhagem encerrada em `sessaoAindaValida`. |
| 24 | Venda e compra sem limite de itens. | Máximo 200. |

## 2d. Correções de 21/10 (pendências baixas)

| Item | O que mudou |
|---|---|
| Resíduo do P1: troca de plano em `VENCIDO` | `featuresVigentes`: na tolerância, os módulos são a interseção do último período pago com o plano atual. Subir não libera nada antes do pagamento (nem gerando a cobrança do plano caro em `/assinatura`); descer tira na hora. Teste: `plano-tolerancia-modulos.test.ts`. |
| Colagem do admin em praça com raspador | `CotacoesImportService.conferirColagemManual`: recusa o dia que a busca automática gravou e cujas cotações ainda existem (uma falha posterior no mesmo dia não reabre a colagem); dia sem busca ou apagado continua aceitando. A tela avisa quando a central é automática. |
| Sessão revogada em `/assinatura` e `/onboarding` | As duas páginas conferem `sessaoAindaValida` (ficam fora do layout `(app)`). |
| Período personalizado só com "até" | Começa no dia 1º do mês do "até", não no do mês corrente. |
| Aviso de higienização | Conta só lote com dinheiro a pagar, como "Contas a pagar". |
| Descrição do módulo Cotações | Inclui o Entreposto de São Paulo (CEAGESP). |

## 2e. Varredura de 21/10 (quinta rodada)

Busca no código inteiro depois do merge de `e1e61e3`. 25 apontamentos; 24 corrigidos, 1 falso positivo.

| Assunto | O que mudou |
|---|---|
| Google adotava senha plantada já confirmada | `User.senhaComprovada` (cadastro público = `false`; redefinir senha = `true`). O Google descarta a senha não comprovada. |
| Server Action com access vencido perdia o formulário | Cookie `cp_exp` + `garantirSessao()` antes de `chamarAction`; proxy responde 401 JSON na escrita e renova antes do download de relatório. 13 componentes passaram a usar `chamarAction`. |
| Login: tentativas paralelas furavam o balde por IP | Consumo atômico antes do Argon2, devolvido no acerto. |
| Produto excluído com ajuste desfazível | Baixa da exclusão vira `PRODUCT_DELETED` (entra nas perdas); desfazer ajuste recusa produto excluído; lista mostra só o que pode ser desfeito (`podeDesfazer`). |
| Compra: botão "Cancelar" oferecido quando o servidor recusa | `podeCancelarAgora` na lista. |
| Reenvio depois de timeout duplicava ajuste, embalagem e higienização | `idempotencyKey` único por empresa nas quatro tabelas + `comIdempotencia`. |
| Chave de idempotência sobrevivia à edição (ou zerava a cada tecla) | `chavePorConteudo` nos formulários. |
| PDV: reenvio devolvia venda diferente do carrinho | A rota devolve `totalAmount`; o PDV confere e avisa. |
| Embalagem que molhou/sumiu ficava no saldo | `registrarBaixa` (QUEBRA `PACKAGING_LOSS`), no custo das embalagens do mês. |
| Caixas: "João" ≠ "joão" | Identidade sem caixa nem espaços, no saldo, no retorno e nos totais. |
| Checkpoint do custo errava ciclo recomeçado em saldo negativo | Coluna `deslocamento`; checkpoints antigos apagados pela migration. |
| Erro de validação mostrava "Dados inválidos" | `mensagemDoErro` (primeiro motivo de `fields`) nos formulários. |
| Nome do cliente na URL ia ao Sentry | `/vendas/clientes/:cliente`. |
| Sino: ids das notificações vistas guardados em claro e não limpos no logout | Hash curto; limpo no logout e no cadastro (que também limpa o snapshot offline). |
| Relatório de papelão somava entrada e saída num "total" | Colunas `valorEntrada` / `valorSaida`. |
| Fluxo de caixa com despesa pendente | Só `PAGO`. |
| Despesa pendente com `paidDate` | Gravado só quando paga. |
| "Vendi no mês" contava venda com data futura | Até o fim de hoje. |
| Desconto, valor de despesa, preço de embalagem e itens do fiado sem teto | Tetos e 2 casas. |
| Ajuste de saída com custo digitado | Custo só na entrada; saída pelo custo médio. |
| Lançamento retroativo reescrevia meses fechados | Piso: início do mês passado (despesa fora). |
| Configurações carregava "Meu plano" em toda aba | Só na aba do plano (`IrParaAba`). |
| Push: endpoint de outro aparelho tomado só pelo endereço | Reatribuição exige as mesmas chaves. |
| Desvincular cotação sem gravar recusa | **Falso positivo**: `desvincular` já grava `TenantCeasaLinkRecusa`. |

**Depois do deploy:** `npx prisma migrate deploy` (cria as colunas e apaga os checkpoints); o cron de billing refaz os checkpoints, ou rode `npx tsx scripts/recalcular-checkpoints.ts`. Usuários antigos ficam com `senhaComprovada = true` (não há como distinguir); a proteção vale para cadastros novos.

Testes: `tests/unit/varredura-21-10.test.ts`, `tests/integration/varredura-2026-10-21.test.ts`, casos novos em `google-login.test.ts`, `push-inscricao.test.ts` e `estoque-checkpoint.test.ts`.

## 3. Pendentes — prioridade baixa

- **Navegação no cliente com sessão revogada** continua lendo até o access expirar (15 min): o layout já montado não roda de novo. Limite do App Router, aceito — a escrita é barrada e toda página carregada do servidor confere a sessão.
- **Lotes de higienização antigos marcados PAGO com caixas ainda fora,** de antes de `80130fa` (dado de produção).
- **Caixas de compras feitas antes do deploy desta versão não são estornadas** se a compra for cancelada nas 24 h seguintes (não têm `purchaseId`).

## 4. Decisões de produto em aberto

- Nenhuma das duas desta rodada (resolvidas em 21/10, ver §2b).
