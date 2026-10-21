# Teste de carga (k6)

Simula o pico do dia de feira: 100 donos de box, cada um na **sua** empresa, alternando entre o PDV, a venda e as telas que se abre entre um cliente e outro. Roda contra o build de produção local e o Postgres local — nunca contra produção (o seed apaga e recria empresas e se recusa a rodar em banco remoto).

## Pré-requisitos

- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) (`winget install k6`) ou a imagem Docker `grafana/k6`.
- Postgres local com as migrations aplicadas e o `npm run db:seed` já rodado (o plano `padrao` precisa existir).

## Passo a passo

```powershell
# 1. Massa: 100 empresas "Carga k6 NNN", 30 produtos e ~5.100 movimentos de
#    estoque cada (dois anos de livro-razão). Grava tests/load/usuarios.json.
npx tsx tests/load/seed-carga.ts

# 2. Build de produção numa porta própria (não mexe no `npm run dev` da 3000).
npx next build
npx next start -p 3100

# 3. Carga: 2 min subindo até 100 usuários, 10 min no platô, 1 min descendo.
k6 run -e BASE_URL=http://localhost:3100 -e RODADA=antes tests/load/pdv.js

# 4. Limpeza.
npx tsx tests/load/seed-carga.ts --limpar
```

Variáveis do k6: `VUS` (padrão 100), `SUBIDA`, `PLATO`, `DESCIDA` (durações do k6, ex.: `30s`), `RODADA` (nome do arquivo de resultado), `DEBUG=1` (loga quando a sessão cai). O seed aceita `K6_EMPRESAS` e `K6_SENHA`.

Para uma fumaça rápida antes da rodada longa: `k6 run -e VUS=3 -e SUBIDA=5s -e PLATO=40s -e DESCIDA=5s -e RODADA=fumaca tests/load/pdv.js`.

## O que cada usuário virtual faz

1. Entra uma vez (`POST /api/auth/login` com `Origin` e JSON, como o navegador).
2. Em laço, com pausas de 3 a 8 s: abre `/vendas/nova`, registra uma venda de 1 a 3 itens (`POST /api/vendas`), abre `/dashboard`, `/estoque` e, 30% das vezes, `/vendas`.

Os cookies de sessão saem com `Secure` porque o `next start` roda como produção, e o cookie jar do k6 não os devolve em `http://`. O script guarda os cookies e manda o cabeçalho `Cookie` à mão — inclusive os que o servidor rotaciona.

## Critérios (thresholds)

| Métrica | Limite |
|---|---|
| Requisições com erro | < 1% |
| p95 das telas | < 1,5 s |
| p95 de `POST /api/vendas` | < 800 ms |
| Respostas 429 e 5xx | nenhuma |
| Sessão perdida (volta ao `/login`) | nenhuma |

O resumo sai no terminal e em `tests/load/resultados/<RODADA>.txt` (e `.json` completo). A pasta e o `usuarios.json` ficam fora do git.

## Lendo o resultado

Local, app e banco dividem a mesma máquina e não há rede entre eles: o número absoluto é **otimista** em latência de rede e **pessimista** em CPU (o Argon2 do login, o Next e o Postgres disputam os mesmos núcleos). Serve para comparar antes e depois de uma mudança, e para achar o que degrada com volume — não para prometer o p95 de produção. Em produção, some ao p95 a ida e volta até `gru1` e lembre que cada função tem a sua CPU.

Para ver as consultas lentas durante a rodada, suba o servidor com `PRISMA_SLOW_MS=100`: cada consulta acima disso vira uma linha `Consulta lenta` no log.
