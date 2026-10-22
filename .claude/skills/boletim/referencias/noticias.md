# CeasaNews

Contexto: `docs/CONTEXTO-AGENTE.md` §9 "CeasaNews".

## Arquivos

- `src/lib/noticias/fontes.ts` — lista de feeds (RSS/Atom e buscas do Google Notícias).
- `src/lib/noticias/parse.ts` — `lerFeed`, `htmlParaTexto`, `limparUrl`, `decodificarEntidades`. **Puro.**
- `src/lib/noticias/filtro.ts` — `classificar`, `familiasCitadas`, `chaveDoTitulo`, `TEMAS`. **Puro.**
- `src/lib/services/noticias.service.ts` — coleta, gravação, leitura.
- Fixtures: `tests/fixtures/noticias/*.xml` (feeds reais).

## Checagens

- Tabelas `noticias` e `noticias_coletas` são globais: `prisma` cru, fora de `TENANT_MODELS`. O dado da empresa (famílias dos produtos) entra só na hora de ler.
- `parse.ts` e `filtro.ts` não fazem I/O nem tocam banco. Mudou o parser ou o filtro? Teste contra as fixtures em `tests/unit/noticias.test.ts`.
- Saída do parse é **texto puro**. A tela nunca usa `dangerouslySetInnerHTML`; imagem só com `https:`. Link passa por `limparUrl`.
- Guarde título, resumo curto, fonte e link — nunca o texto da matéria.
- Dedupe por `url` **e** por `chaveTitulo` (`chaveDoTitulo`): a mesma matéria chega do site e do Google Notícias.
- Filtro: termo forte entra sozinho; fora disso exige alimento de balcão **e** fator de preço; termo negativo derruba. A maioria dos itens de feed geral cai — é o esperado, não afrouxe para "ter mais notícia".
- Feed novo só entra em `fontes.ts` depois de sondado: resposta 200 com item recente. Feed parado (ex.: Agrolink, 2020) não entra. Adicione a fixture real dele.
- Feed isolado falhando não avisa; **todos** falhando gera `NOTICIAS_FALHA` ao super-admin.
- Coleta: sub-tarefa do cron de billing (depois das cotações, `.catch` próprio) e sob demanda ao abrir `/ceasanews` via `after()`, se a última tiver mais de 2 h. Ver skill `cobranca`.
- Retenção: 30 dias guardados, 7 na tela.
