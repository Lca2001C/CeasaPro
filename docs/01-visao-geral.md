# 1. Visão geral

## O que é

O **CeasaPro** é um sistema SaaS (software como serviço) de gestão para **comercializadores do CEASA** — os comerciantes que compram e revendem hortifruti em boxes do entreposto. O objetivo é centralizar, num único aplicativo simples e mobile-first, o controle diário do negócio: produtos, fornecedores, compras, vendas, fiado, estoque, caixas plásticas, higienização, embalagens, despesas, além de dashboard financeiro e relatórios.

O sistema é **multi-empresa (multi-tenant)**: cada comerciante (empresa/cliente) tem seus dados totalmente isolados dos demais. O acesso é pago (assinatura mensal), gerenciado por um **super-admin** que cadastra as empresas, define planos e valores, e ativa/suspende/bloqueia contas.

## Para quem

- **Comerciante (OWNER):** o dono do box. Usa o dia a dia do sistema — quase sempre pelo celular.
- **Super-admin:** opera a plataforma — cadastra clientes, define planos e mensalidades, acompanha pagamentos e métricas.

> Nesta versão há **dois papéis**: `SUPER_ADMIN` (plataforma) e `OWNER` (empresa). Um perfil de funcionário (`STAFF`) está previsto como evolução futura.

## Princípios de produto

- **Simples e de fácil compreensão.** Público com pouca familiaridade com tecnologia: telas objetivas, botões grandes, textos em português, poucos cliques.
- **Mobile-first.** Layout pensado primeiro para o celular (menu inferior + tela de venda rápida); no desktop vira barra lateral.
- **Baixo custo.** Stack e hospedagem escolhidas para rodar barato (Vercel + Neon).
- **Confiável no que é financeiro.** Cálculos centralizados, valores em `Decimal` (sem erro de arredondamento), operações atômicas (transações) e trilha de auditoria.

## Conceitos-chave

| Conceito | O que é |
|---|---|
| **Empresa / Tenant** | Uma conta de comerciante. Todos os dados operacionais pertencem a uma empresa e nunca vazam para outra. |
| **Assinatura** | Vínculo da empresa a um plano, com valor mensal, período de teste (trial), vencimento e status. |
| **Plano** | Pacote comercial (preço, limite de usuários e **módulos** liberados). |
| **Módulo** | Uma área do sistema. Módulos-núcleo são sempre liberados; módulos opcionais dependem do plano. |
| **Estoque derivado** | O saldo de estoque e de caixas plásticas não é um campo editável — é **calculado** somando os movimentos (livro-razão). Isso torna tudo auditável. |
| **Fiado** | Venda a prazo que vira uma conta a receber, com pagamentos parciais e saldo. |
| **Auditoria** | Registro de quem fez cada operação sensível (criar/editar/excluir/pagar), com antes/depois. |

## Fluxo típico de uso (empresa)

1. O super-admin cria a empresa e o usuário dono; envia as credenciais.
2. No primeiro acesso, o dono passa pelo **onboarding** (dados da empresa → 1º fornecedor → 1º produto).
3. Registra **compras** → o estoque entra automaticamente (com o frete rateado no custo).
4. Vende pela **frente de caixa (PDV)** → baixa o estoque, lança no financeiro; se for fiado, cria a conta a receber.
5. Recebe pagamentos de **fiado** (parcial ou total).
6. Lança **despesas**; controla **caixas plásticas**, **higienização** e **embalagens** (se o plano incluir).
7. Acompanha o **dashboard** (o que vendeu hoje, a receber, estoque, lucro do mês) e gera **relatórios** (Excel/impressão).
8. Paga a **mensalidade** via PIX na tela de assinatura.

## Onde cada assunto está documentado

- Como o sistema é construído por dentro → [Arquitetura](02-arquitetura.md)
- O que cada tela faz → [Funcionalidades](03-funcionalidades.md)
- Como os dados são organizados → [Modelo de dados](04-modelo-de-dados.md)
- Como funcionam planos e cobrança → [Planos e módulos](05-planos-e-modulos.md)
