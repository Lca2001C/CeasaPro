# Auditoria de bugs — 2026-09-30

Segunda rodada, nas frentes que a de [2026-09-23](auditoria-2026-09-23.md) não varreu a fundo:

- PDV (servidor e cliente);
- compras e estoque;
- fiado;
- caixas e higienização;
- embalagens e despesas;
- relatórios e painel;
- cotações (importação e leitura);
- super-admin;
- cadastro, onboarding e CRUDs;
- bibliotecas e validações;
- crons e push;
- frontend transversal.

Houve um auditor por frente, e cada achado passou por verificação adversarial: dois verificadores independentes para crítico/alto, um para os demais. Um crítico de completude varreu o que ficou de fora. Dos 82 achados, 80 sobreviveram, cerca de 76 distintos depois de juntar os repetidos. O crítico acrescentou 2, conferidos na correção. Tudo foi corrigido, cada um com teste de regressão.

- **Linha de base:** unit 990, componentes 19, integração 608.
- **Depois:** unit 1095/1095, componentes 56/56, integração 718/718, `tsc` e `eslint` limpos.

---

## 1. Mudanças de comportamento que o cliente pode notar

| O quê | Antes | Agora |
|---|---|---|
| **Custo médio / valor em estoque** | média de TODAS as entradas da história; sobrava valor em produto com saldo zero | **média ponderada móvel** do estoque atual, em ordem de gravação; saldo ≤ 0 vale zero e reinicia a média. Venda antiga mantém o `unitCostAtSale` gravado. A tela de Estoque e o cartão do painel passam a mostrar o mesmo número. |
| **Caixas quebradas na chegada** | contavam também como limpas/sujas | saem do pote em que chegaram. Quem já lançou compra com quebradas vê "limpas" cair, e pode ficar negativo se já vendeu contra o saldo inflado. O número novo é o real. |
| **Relatório de inadimplentes** | contas ABERTAS dentro do período (escondia os devedores antigos) | **posição na data de corte**: tudo que estava vencido (ou sem vencimento há mais de 30 dias) até o fim do período |
| **Lucro por produto** (relatórios e painel) | ignorava o desconto da venda | o desconto total é rateado entre as linhas (`FinancialCalc.receitaLiquidaPorLinha`) |
| **Excel** | números como texto, apóstrofo visível | números, moeda e data de verdade; texto protegido com formato `@` |
| **CNPJ** | texto livre | só dígitos, com DV conferido. Empresa com CNPJ inválido gravado precisa corrigir ou apagar para salvar Configurações. O CNPJ com DV errado deixa de ir ao Mercado Pago no PIX. |
| **Unidade de venda** | podia trocar em produto com histórico (reinterpretava estoque e vendas) | recusada com mensagem; o caminho é criar outro produto |
| **Plano com troca agendada** | podia ser desativado ou excluído | recusado enquanto houver cliente com a troca agendada |
| **Data impossível** (`31/02`, `31/04`) | virava outro dia sem aviso | recusada em todos os formulários (`parseFormDateTz` lança `ValidationError`) |
| **Caixa plástica sem cliente no PDV** | barrada mesmo sem o módulo de caixas | só exigida com o módulo `caixas` ligado |
| **Janela de 24 h do cancelamento** | contada a partir da data escolhida (00:00) | contada a partir do registro da venda |

## 2. Corrigido, por frente

**PDV — servidor.**
- Fiado de R$ 0 gravava venda e estoque e depois respondia erro, e cada retentativa baixava de novo. Agora é recusado antes de gravar.
- Telefone e observação do fiado manual passaram para dentro da transação.
- O cancelamento estorna só as caixas que ainda estão com AQUELE cliente (antes usava o saldo global e travava).
- O filtro por forma de pagamento soma só a parte daquela forma.
- "Ver canceladas" não soma as canceladas no total.
- A exclusão do fiado no cancelamento usa compare-and-set.
- Retentativa concorrente com a mesma chave recebe a venda já registrada.
- A linha nunca fica negativa por arredondamento.

**PDV — cliente.**
- O troco no pagamento misto compara com a parte em dinheiro.
- Os erros de campo do servidor aparecem na tela.
- Quantidade somada em milésimos (não arredonda para 2 casas).
- Totais de linha e trava do desconto em centavos.
- O alerta de "carrinho vazio" não reaparece na venda seguinte.
- "Repetir última venda" pula produto inativo.
- A busca ignora acento.

**Compras e estoque.**
- Custo médio móvel (ver §1).
- Acerto de inventário para menos pela tela.
- Toque duplo em "Salvar compra" travado no cliente **e no servidor**: `Purchase.idempotencyKey` com índice único, na migration `20260930120000_compra_idempotencia`.
- Frete de compra com itens a R$ 0 rateado pela quantidade, e as parcelas sempre somam o frete.

**Fiado.**
- O "Receber" rápido no celular não navega sozinho para o detalhe.
- A aba "Pagas" mostra o total a receber real.
- O detalhe de venda mista mostra o total da venda, o pago no balcão e o que ficou no fiado.

**Caixas e higienização.**
- Perda e retorno do higienizador só com vínculo ao lote.
- A tela deixou de oferecer tipos que o servidor recusa.
- Reduzir ou excluir um envio confere o saldo sob lock.
- Perdas e devoluções concorrentes usam lock e compare-and-set.
- Os totais da higienização contam todos os lotes em aberto, não só os 500 mais recentes.

**Embalagens e despesas.**
- Parcela recorrente não duplica em corrida.
- Pagamento duplo é recusado.
- Venda de embalagem trava o saldo (`FOR UPDATE`).
- Cartões de embalagem cobrem o mês inteiro.
- Ligar o controle de estoque duas vezes não duplica o saldo inicial.
- Soma de saldo em `bigint` e teto de quantidade.
- A aba "Pagas" ordena pela data de pagamento.
- Datas inválidas na URL de /despesas não dão mais 500.
- A mensagem de "replicar mês" é honesta.

**Relatórios e painel.**
- Desconto rateado no lucro (ver §1).
- Inadimplentes por data de corte (ver §1).
- Excel com números (ver §1).
- A despesa sem vencimento entra no relatório.
- Venda de produto sem compra aparece em "Sem fornecedor".
- As listas do Início param em "até agora".
- As datas do período são validadas, com volta ao preset "mês".
- Exportar período personalizado leva as datas.
- Estoque parado usa o custo novo.

**Cotações.**
- Orçamento de tempo aplicado DENTRO de cada central, e o alarme de defasagem sempre roda.
- Grade CEASAMINAS com produtos e sem preço vira FALHA, não "dia sem boletim".
- `apagarBoletim` em transação com `audit()`, preservando o rastro.
- A tela do admin usa o mesmo critério de alarme do cron.
- Boletim publicado depois do cron é recuperado (`completarLacunas`).
- Dois produtos no mesmo item do boletim aparecem avisados.
- "Comprei acima do boletim" compara com o boletim do DIA da compra (30 dias) e com a embalagem certa.
- CSV com preço zero é recusado.
- Embalagem do CSV normalizada sem partir série existente.

**Super-admin.**
- A nova empresa pega o preço do plano escolhido.
- Plano com troca agendada é protegido (ver §1).
- Filtros de /admin/usuarios aplicados antes do corte de 200.
- `deletePlan` atômico.
- Auditoria dentro da transação em todas as ações de admin, inclusive `setTenantStatus` (pendência de 09-23).

**Cadastro, CRUDs e bibliotecas.**
- Unidade de venda protegida (ver §1).
- CNPJ com DV (ver §1).
- Os formulários de empresa e fornecedor mostram o erro de cada campo.
- A confirmação de e-mail não diz "expirou" para conta já confirmada.
- **Open redirect** em `safeRedirectPath` fechado (`/.//evil.com`, `/\evil.com` etc.).
- Fallback `new Date(v)` removido de `parseFormDateTz` e `parseEntrada`.

**Crons e push.**
- O push diário decide pelo status CALCULADO (não manda para quem já está bloqueado).
- O lembrete informa o valor que será cobrado com troca agendada (`valorDevido`).
- Dias contados em dias de calendário BRT, com texto "hoje".
- Cron sobreposto não duplica e-mail nem push (reserva sob advisory lock).
- `pushsubscriptionchange` reinscreve no service worker.
- "N clientes com fiado vencido" conta clientes, não entregas.

**Frontend.**
- Falha de rede numa Server Action não derruba mais a tela (`chamarAction`), em 25 componentes.
- /assinatura bloqueada não manda para Configurações.
- O menu lateral marca um único item.
- O PDV lê só as quantidades do estoque, sem o custo.

**Achados do crítico de completude.**
- Um refresh token rotacionado há menos de 30 s ainda gerava sessão nova depois de troca de senha ou reuso detectado. A graça agora confere se a família foi derrubada.
- O script `reset-admin-password` não revogava as sessões do admin. Agora revoga, na mesma transação.

## 3. Pendente

> Todos os itens desta seção foram resolvidos no mesmo dia; ver §4.

Da rodada anterior, seguem abertos os itens da §2 de [auditoria-2026-09-23.md](auditoria-2026-09-23.md). O principal é o cron de billing, que pode estourar 60 s com ~100–150 pagantes. As cotações ganharam orçamento de tempo próprio nesta rodada; a reconciliação do Mercado Pago, não.

Novos, pequenos:
- **"Este mês" nos relatórios × painel:** o relatório vai até hoje; o painel conta despesas até o fim do mês.
- **Plano já inativo com troca agendada antes desta correção:** `valorDevido` não olha `active`.
- **Push/lembrete:** se o processo cair entre a reserva e o envio, aquele período fica sem aviso. A troca é deliberada: antes, a falha era o envio em dobro.
- **Seletor de unidade:** o formulário de produto não desabilita a unidade quando há histórico; o servidor recusa e a tela mostra o aviso.

## 4. Pendências das duas rodadas — resolvidas em 2026-09-30

Fecham a §2 de [auditoria-2026-09-23.md](auditoria-2026-09-23.md) e a §3 acima. Suíte completa depois: unit 1190/1190, componentes 63/63, integração 771/771, `tsc` e `eslint` limpos.

Duas migrations:
- `20260930120000_compra_idempotencia`: adiciona `purchases.idempotencyKey` + índice único.
- `20260930150000_reconciliacao_rotativa_e_nao_creditado`:
  - `subscription_payments.lastReconciledAt` / `uncreditedAt` / `uncreditedReason`;
  - índice em (`status`, `lastReconciledAt`);
  - dois valores novos em `AdminNotificationKind`.

**Cobrança**
- **Cron de billing (era ALTO).** A reconciliação ganhou:
  - orçamento de tempo de 20 s e timeout de 8 s por chamada ao Mercado Pago;
  - no máximo 6 chamadas ao mesmo tempo;
  - fila rotativa por `lastReconciledAt` (nunca conferidas primeiro).

  As tarefas locais (status, lembretes, recorrentes, limpezas, cotações) rodam mesmo se a reconciliação falhar.
- **QR PIX substituído** agora é cancelado no Mercado Pago (`cancelPayment`), além do banco. Vale para troca de PIX, cartão, troca de plano, cancelamento da assinatura e aprovação do mês.
  - Linhas CANCELADO recentes entram na reconciliação.
  - Pagamento aprovado que não comprou mês (valor a menor, duplicado) é marcado `uncreditedAt` e gera um aviso ao super-admin (`PAGAMENTO_NAO_CREDITADO`).
  - Cartão recusado não cancela mais o PIX aberto.
- **Pagamento antecipado:** dentro de 3 dias do vencimento (ou depois dele), a `/assinatura` cobra o próximo período (`competenciaACobrar`), no valor de `valorDevido`.
- **Chargeback desfeito por pagamento:** o acesso volta sozinho, como antes, mas o admin é avisado (`BLOQUEIO_DESFEITO_POR_PAGAMENTO`). O doc 05 foi corrigido.
- **Cancelado com período vencido** pode trocar de plano ao voltar.
- **`addOneMonth`** soma o mês na data civil de Brasília.
- **`reativarAssinatura`** passou a fazer a mudança e o audit na mesma transação.
- **Plano agendado inativo:** `valorDevido` o ignora, e `aplicarTrocaProgramada` o descarta.

**Sessão e auth**
- **Sessão revogada** não cai mais em tela de erro sem saída. O layout redireciona para `/api/auth/renovar?revogada=1`, que limpa os cookies e leva ao login. Sem laço.
- **Callback do Google, login, reset e troca de senha:** nunca devolvem 500 cru.
- **Troca e redefinição de senha:** hash, revogação, `sessionEpoch` e audit na mesma transação.

**Módulos**
- **Higienização** no lucro do mês e em "pagas no mês" soma os pagamentos pela data de cada um (`resumoDaHigienizacao`).
- **Fiado "Pagas"/"Todas"** paginado (50), mais recentes primeiro. Os totais seguem sobre tudo.
- **Excluir fiado** estorna só as caixas que ainda estão com o cliente.
- **Compra** ignora caixas sem o módulo `caixas`, e a tela esconde o bloco.
- **"Este mês":** despesas por vencimento vão até o fim do mês no relatório, como no painel (`Period.toVencimento`).
- **Unidade de venda** desabilitada na tela quando o produto tem histórico.

**PWA**
- **Service worker** registrado como `/sw.js?v=<build>`. A versão vem de `VERCEL_DEPLOYMENT_ID`, com `VERCEL_GIT_COMMIT_SHA` como reserva. Resultado: um service worker novo por deploy.
  - Ao ativar, apaga os caches de outros builds.
  - Ícones em stale-while-revalidate.
- **Snapshot offline** com `schemaVersion`: a tela de consulta ignora formato desconhecido e tolera `total: null`.

**Mantido por decisão:** a mensagem do 401 do Mercado Pago que cita `MERCADOPAGO_ACCESS_TOKEN` (diagnóstico do operador, com teste).

**Não verificado automaticamente:**
- o e2e de sessão revogada entre dois aparelhos (Playwright);
- que a Vercel expõe `VERCEL_DEPLOYMENT_ID` no build. Sem ele, a versão cai para o SHA do commit, e um redeploy do mesmo commit não reinstala o service worker.
