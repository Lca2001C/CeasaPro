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

## 3. Pendentes — prioridade baixa

- **Gráfico "Últimos 6 meses" × "Resultado do mês":** a série não soma higienização enviada nem embalagens (`painel-financeiro.service.ts:82-88`).
- **Relatório "Contas pagas" × cartão "Pagas":** o relatório não soma o que foi pago ao higienizador (`report.service.ts:270-273`).
- **`replicarMes` sem trava:** dois toques simultâneos duplicam o mês (`despesas.service.ts:1164-1205`).
- **Período personalizado só com "até" anterior ao mês corrente:** gera relatório vazio, sem erro (`dates.ts:91-117`).
- **Aviso de higienização conta lotes já quitados** (`avisos.service.ts:178`).
- **Colar boletim manual:** "1.200" vira R$ 1,20, enquanto o raspador lê 1200 (`cotacoes/csv.ts:45-51`).
- **Admin publica boletim manual em praça com raspador** (`admin-cotacoes.actions.ts:41-61`, `cotacoes-envio.service.ts:219-256`).
- **"Usar o sistema" com duplo clique** cria dois ambientes; o órfão aparece como cliente (`admin.service.ts:373-459`).
- **Upload de foto sem limite de volume:** objetos órfãos no R2 (`produtos.actions.ts:33`).
- **Super-admin consegue redefinir a senha de outro super-admin** (`admin.service.ts:1076`).
- **Super-admin não consegue desfazer no próprio ambiente:** as checagens usam `role !== "OWNER"` (compras, vendas, fiado).
- **Sessão revogada ainda LÊ páginas até o access expirar (15 min):** `/assinatura`, `/onboarding` e páginas acessadas por navegação no cliente. Escrita já é barrada.
- **Corrida em `emailIdentity`:** cadastros simultâneos com `+1`/`+2` podem render trials duplicados (falta índice único).
- **Corrida na rotação do refresh:** chamadas simultâneas furam o teto da janela de graça (`auth/refresh.ts:104-166`).
- **Route Handlers sem conferência de `Origin`/`Content-Type`:** hoje protegidos só pelo `SameSite=Lax` (`http/with-route.ts:117`).
- **Lotes de higienização antigos marcados PAGO com caixas ainda fora,** de antes de `80130fa` (dado de produção).
- **Caixas de compras feitas antes do deploy desta versão não são estornadas** se a compra for cancelada nas 24 h seguintes (não têm `purchaseId`).
- **PIX de outra competência não é cancelado** ao gerar o do mês novo; pago em dobro, credita dois meses.

## 4. Decisões de produto em aberto

- **Fiado errado ou incobrável depois de 24 h não tem saída.** Antes, o fiado sem pagamento era apagado a qualquer tempo. Agora não há como baixar a dívida, e o aviso de "fiado vencido" volta todo dia. Caminho sugerido: "Baixar como perda", que registra a perda no dia em que é lançada, sem reescrever o passado.
- **Embalagem vendida entra no lucro sem custo.** A entrada de embalagem não gera conta, então o lucro só fica certo se o dono lançar a compra da embalagem em Despesas. Caminhos: gerar a conta na entrada de embalagem com custo, ou calcular o CMV da embalagem.
