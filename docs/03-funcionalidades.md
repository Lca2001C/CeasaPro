# 3. Funcionalidades

Este documento descreve cada área do sistema, o que ela faz e as regras de negócio envolvidas. As rotas são mostradas entre parênteses.

## Sumário

- [Autenticação e acesso](#autenticação-e-acesso)
- [Onboarding](#onboarding)
- [Dashboard](#dashboard)
- [Produtos](#produtos)
- [Fornecedores](#fornecedores)
- [Compras](#compras)
- [Vendas / Frente de caixa (PDV)](#vendas--frente-de-caixa-pdv)
- [Fiado](#fiado)
- [Estoque](#estoque)
- [Despesas](#despesas)
- [Caixas plásticas](#caixas-plásticas)
- [Higienização](#higienização)
- [Venda de embalagens](#venda-de-embalagens)
- [Relatórios](#relatórios)
- [Atividades (auditoria da empresa)](#atividades-auditoria-da-empresa)
- [Meu plano](#meu-plano)
- [Configurações da empresa](#configurações-da-empresa)
- [Assinatura e cobrança](#assinatura-e-cobrança)
- [Painel do super-admin](#painel-do-super-admin)

---

## Autenticação e acesso

- **Login** (`/login`): e-mail + senha. Mensagem genérica em caso de erro (não revela se o e-mail existe). **Rate limit** de 5 tentativas / 15 min por IP+e-mail.
- **Recuperação de senha** (`/recuperar-senha` e `/recuperar-senha/[token]`): informa o e-mail → recebe um link (via Resend) válido por 1 hora → define nova senha. Resposta sempre genérica. Ao redefinir, todas as sessões são revogadas.
- **Logout**: encerra a sessão e revoga o refresh token.
- **Sessão**: renovada automaticamente por refresh token; mudanças de status (assinatura/bloqueio) propagam em ≤15 min.

## Onboarding

- Rota `/onboarding`, exibida no **primeiro acesso** do OWNER (enquanto `onboardingCompletedAt` for nulo). Assistente em passos:
  1. Confirmar dados da empresa (nome, telefone, endereço/box).
  2. Cadastrar o primeiro fornecedor (opcional — pode pular).
  3. Cadastrar o primeiro produto (opcional — pode pular).
- Ao concluir, marca o onboarding como feito e leva ao dashboard. A empresa **demo** do seed já vem com onboarding concluído.

## Dashboard

Rota `/dashboard`. Pensado para "entender tudo em menos de 10 segundos".

- **Avisos** (topo, quando houver): fiado vencido, despesas vencidas, despesas a vencer em 7 dias, higienização a pagar — cada aviso leva à tela correspondente.
- **4 números principais:** *Hoje vendi*, *Tenho para receber* (fiado em aberto), *Estoque* (valor total), *Lucro do mês*.
- **Gráfico** de vendas dos últimos 30 dias.
- Botão grande **Nova venda**.
- **Mais indicadores:** vendas na semana/mês, margem líquida do mês, contas a pagar; e listas de **mais vendidos**, **produtos com prejuízo** e **estoque parado** (30+ dias sem venda).

## Produtos

Rotas `/produtos`, `/produtos/novo`, `/produtos/[id]`. CRUD via Server Actions.

- Campos: nome, unidade de venda (caixa/kg/saco/bandeja/unidade), quantidade por recipiente, tipo de caixa (plástica/papelão/madeira), capacidade do saco, ativo/inativo.
- Buscar por nome; marcar ativo/inativo; exclusão é **soft delete** (com confirmação).
- Produtos com histórico não são apagados de fato (proteção de integridade) — usa-se a exclusão lógica.

## Fornecedores

Rotas `/fornecedores`, `/fornecedores/novo`, `/fornecedores/[id]`.

- Campos: nome, telefone, endereço, observações, ativo/inativo.
- CRUD completo (soft delete). Histórico de compras por fornecedor disponível no serviço.

## Compras

Rotas `/compras`, `/compras/nova`. Operação **transacional** (Route Handler `POST /api/compras`).

- Cabeçalho: data, fornecedor (opcional), frete, observações. Itens: produto, quantidade, preço unitário (repetíveis).
- Regras (tudo numa transação):
  - `valor_total_compra = Σ(qtd × preço) + frete`.
  - O **frete é rateado** entre os itens proporcionalmente ao valor de cada linha; o custo real por unidade (`unitCost`) grava o frete embutido.
  - Cada item gera um **movimento de estoque de ENTRADA** → o estoque sobe automaticamente.
  - Registra auditoria.

## Vendas / Frente de caixa (PDV)

Rotas `/vendas` (histórico) e `/vendas/nova` (PDV). Venda transacional (`POST /api/vendas`).

- **PDV** (tela de venda rápida): busca de produto com poucos toques, carrinho com quantidade e preço editáveis, total em destaque, formas de pagamento (**Dinheiro / PIX / Cartão / Fiado**) e cliente (obrigatório se for fiado).
- Ao finalizar (transação atômica):
  - valida o **saldo de estoque** de cada item (bloqueia venda acima do disponível);
  - cria a venda e itens; `valor_total_venda = qtd × valor`;
  - **baixa o estoque** (movimento de SAÍDA), gravando o custo do produto no momento (`unitCostAtSale`) para o cálculo de lucro;
  - se **fiado**, cria a **conta a receber**;
  - registra auditoria.
- **Histórico** lista as vendas com cliente, forma de pagamento, data e total.

## Fiado

Rotas `/fiado` (lista) e `/fiado/[id]` (detalhe). Operação de pagamento em `POST /api/fiado/pagamento`.

- A lista mostra as contas **em aberto** com o **saldo** de cada cliente e o **total geral a receber**.
- No detalhe: total, pago, saldo, histórico de pagamentos.
- **Pagamento parcial**: informa valor e forma; o sistema soma ao pago e recalcula o saldo. Ao quitar (pago ≥ total), o status vira **PAGO**. Não permite pagar acima do saldo.
- `saldo = total − pago` (nunca negativo).

## Estoque

Rotas `/estoque` (posição) e `/estoque/ajuste`. Movimento manual em `POST /api/estoque/ajuste`.

- A **posição** é **derivada** dos movimentos: `saldo = Σ(ENTRADA, AJUSTE) − Σ(SAÍDA, QUEBRA, DOAÇÃO)`. Mostra quantidade e valor por produto e o **valor total em estoque**.
- Entradas/saídas são automáticas (compra/venda). O **ajuste manual** cobre **quebra/perda**, **doação** e acerto de inventário, com motivo. O custo unitário usado é o custo médio das entradas (ou informado).

## Despesas

Rotas `/despesas`, `/despesas/nova`, `/despesas/[id]`.

- Campos: descrição, valor, tipo (**fixa/variável**), categoria, vencimento, pagamento, situação (**pendente/pago**).
- **Categorias**: 14 categorias iniciais criadas no cadastro da empresa (aluguel do box, energia, internet, contabilidade, pró-labore, impostos, seguro, condomínio, água, telefone, salários, INSS, sistema de gestão, outros).
- A lista mostra o resumo: total de **fixas**, **variáveis** e **geral**.
- Alimenta o cálculo de **lucro líquido** e as **contas a pagar** do dashboard.

## Caixas plásticas

Rotas `/caixas-plasticas`, `/caixas-plasticas/novo`. **Módulo opcional** (depende do plano). Livro-razão de movimentos:

- Tipos de movimento: **ENTRADA** (recebidas, com origem/fornecedor e caixas quebradas na chegada), **SAÍDA** (enviadas ao cliente), **RETORNO** (devolvidas pelo cliente) e **QUEBRA** (perdida/sumida — com cliente ou no estoque).
- **Saldos derivados** (nunca campo mutável):
  - *Vazias no estoque* = ENTRADA − SAÍDA + RETORNO − QUEBRA(sem cliente) − quebradas na chegada;
  - *Com clientes* = SAÍDA − RETORNO − QUEBRA(com cliente);
  - *Perdidas/quebradas* = todas as QUEBRA + quebradas na chegada.
- Consistência: não deixa a saída superar as vazias, nem o retorno superar as que estão com clientes.

## Higienização

Rotas `/higienizacao`, `/higienizacao/nova`, `/higienizacao/[id]`. **Módulo opcional**.

- Registro de **envio** de caixas ao higienizador: responsável, data, quantidade, valor por caixa (→ total).
- **Devolução** parcial acumulativa (não pode devolver mais que o enviado) e **pagamento** parcial ao higienizador (não pode pagar mais que o saldo).
- Status automático: **ENVIADO → DEVOLVIDO → PAGO**.
- Cards de *caixas a receber* e *total a pagar*.

## Venda de embalagens

Rotas `/embalagens`, `/embalagens/nova`. **Módulo opcional**.

- **Tipos** cadastráveis (caixa plástica, papelão, madeira, sacaria… — os padrões vêm no cadastro da empresa).
- Venda: tipo, cliente (opcional), data, quantidade, valor unitário (→ total).
- Totais: embalagens vendidas e total vendido. Abas *Vendas* | *Tipos*.

## Relatórios

Rotas `/relatorios` (central) e `/relatorios/[tipo]` (visualização). Exportação em `GET /api/reports/[type]/export`.

- Todos com **filtro por período** (hoje, 7 dias, este mês, mês passado) e ações **Imprimir / PDF** (impressão do navegador) e **Baixar Excel** (.xlsx real via `exceljs`).
- **Básicos** (sempre disponíveis): Vendas, Compras, Fiado, Despesas, Estoque.
- **Avançados** (módulo `relatorios_avancados`): Lucro por produto, Mais vendidos, Clientes inadimplentes, Fornecedores, Fluxo de caixa, Caixas plásticas, Higienização, Venda de embalagens.
- Cada exportação registra um histórico em `report_exports` (metadados; o arquivo é reproduzível a qualquer momento).

## Atividades (auditoria da empresa)

Rota `/atividades`. Mostra, em linguagem simples, as ações registradas na empresa ("Fulano cadastrou produto", "Fulano registrou pagamento em conta de fiado"…), com data, IP e um **detalhe expansível** (antes/depois).

## Meu plano

Rota `/plano`. Mostra o plano atual (nome, preço, situação, vencimento), **todos os módulos** com ✓/✗ (incluído ou não), o limite de usuários e o **uso atual** (nº de produtos e usuários). Quando o usuário tenta acessar um recurso fora do plano, cai aqui com um aviso e um convite para falar sobre upgrade. Ver [Planos e módulos](05-planos-e-modulos.md).

## Configurações da empresa

Rota `/configuracoes`. Duas abas:

- **Empresa:** nome fantasia, razão social, CNPJ, telefone, endereço, horário de funcionamento.
- **Assinatura:** plano, situação, mensalidade, vencimento e atalho para a tela de assinatura.

## Assinatura e cobrança

Rota `/assinatura` (acessível mesmo com a conta bloqueada). Integração **Mercado Pago** via **PIX**:

- O cliente gera a cobrança do mês → o sistema cria um pagamento PIX no Mercado Pago e exibe o **QR Code** e o **copia-e-cola**.
- O pagamento é confirmado por **webhook** (`/api/webhooks/mercadopago`): ao ser aprovado, a assinatura vai para **ATIVO** e o vencimento avança um mês.
- Um **cron** diário (`/api/cron/billing`) recalcula o status de todas as assinaturas.
- **Trial:** empresas novas começam com período de teste (padrão 15 dias).
- **Bloqueio:** vencida além da tolerância → **suspensa**; a empresa é redirecionada para `/conta/suspensa` e só acessa a tela de regularização. Ver [Planos e módulos](05-planos-e-modulos.md) e [Segurança](06-seguranca.md).

## Painel do super-admin

Área `/admin` (somente `SUPER_ADMIN`).

- **Visão geral** (`/admin`): nº de empresas, MRR (receita mensal recorrente), ativas, inadimplentes, novos clientes no mês, recebido no mês, em teste grátis, e distribuição por status.
- **Clientes** (`/admin/clientes`, `/admin/clientes/novo`, `/admin/clientes/[id]`):
  - **Criar empresa + dono** numa transação (gera senha temporária para o OWNER, cria a assinatura em trial e as categorias/tipos padrão).
  - No detalhe: **ativar / suspender / bloquear** a empresa (bloqueio imediato — derruba as sessões ativas), editar mensalidade, ver usuários e histórico de pagamentos.
- **Planos** (`/admin/planos`): criar e **editar** planos — preço, limite de usuários, ativo e **quais módulos opcionais** o plano inclui.
- **Pagamentos** (`/admin/pagamentos`): todas as cobranças de mensalidade das empresas.
- **Auditoria** (`/admin/auditoria`): trilha global de ações, com o nome da empresa.
