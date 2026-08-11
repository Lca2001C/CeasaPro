# Documentação do CeasaPro

Documentação completa do **CeasaPro** — SaaS de gestão para comercializadores do CEASA (Belo Horizonte). Multi-empresa, mobile-first, com painel de super-admin e cobrança por assinatura (Mercado Pago).

## Índice

1. [Visão geral](01-visao-geral.md) — o que é, para quem, principais conceitos.
2. [Arquitetura](02-arquitetura.md) — stack, camadas, multi-tenancy, autenticação, padrões.
3. [Funcionalidades](03-funcionalidades.md) — todos os módulos e telas, detalhados.
4. [Modelo de dados](04-modelo-de-dados.md) — todas as tabelas, campos, relações e enums.
5. [Planos e módulos](05-planos-e-modulos.md) — assinatura, gating de módulos, tela "Meu plano".
6. [Segurança](06-seguranca.md) — autenticação, isolamento por empresa, auditoria, boas práticas.
7. [Instalação e deploy](07-instalacao-e-deploy.md) — rodar local, deploy de baixo custo, backup.
8. [Desenvolvimento](08-desenvolvimento.md) — estrutura de pastas, scripts, testes, convenções.

> A **especificação original** do produto (requisitos brutos) está em [ESPECIFICACAO.md](ESPECIFICACAO.md).
> O guia rápido de uso está no [README](../README.md) da raiz.

## Resumo em uma frase

Um comerciante do CEASA usa o CeasaPro no celular para cadastrar produtos e fornecedores, registrar compras (que dão entrada no estoque) e vendas (frente de caixa, com baixa de estoque e fiado), controlar caixas plásticas, higienização e embalagens, lançar despesas e acompanhar dashboard e relatórios — tudo isolado por empresa; o super-admin gerencia as empresas assinantes, os planos e a cobrança.

## Status do projeto

Todas as fases planejadas foram entregues e verificadas (typecheck, testes automatizados e build de produção):

- **Fase 1 (MVP):** autenticação multi-empresa, produtos, fornecedores, compras, vendas/PDV, fiado, estoque, despesas, dashboard, relatórios básicos, configurações, onboarding, super-admin e cobrança Mercado Pago.
- **Fase 2:** caixas plásticas, higienização, venda de embalagens e relatórios avançados.
- **Fase 3:** PWA (instalável), avisos no painel, métricas avançadas, telas de auditoria.
- **Planos:** gating de módulos por plano + tela "Meu plano".
