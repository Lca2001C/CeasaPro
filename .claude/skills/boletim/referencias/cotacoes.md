# Cotações do CEASA

Antes de editar, leia `docs/auditoria-2026-09-07.md` (o que já mordeu neste módulo) e `docs/CONTEXTO-AGENTE.md` §9 "Cotações do CEASA" e §15.

## Arquivos

- Regras puras: `src/lib/cotacoes/` (`nome.ts`, `embalagem.ts`, `embalagem-texto.ts`, `frescor.ts`, `variacao.ts`, `grafico.ts`, `alerta.ts`, `csv.ts`, `serie.ts`, `http.ts`).
- Fontes: `src/lib/cotacoes/fontes/` — contrato em `tipos.ts`, registro em `index.ts` (`FONTES`, `fontePara`), adaptadores `ceasaminas.ts` e `ceagesp.ts`.
- Services: `cotacoes.service.ts`, `cotacoes-import.service.ts`, `cotacoes-alertas.service.ts`, `cotacoes-historico.service.ts`, `cotacoes-envio.service.ts`.

## Checagens

### Tenant

- `ceasa_centrals`, `ceasa_products`, `ceasa_quotes`, `ceasa_import_runs` são **globais**: `prisma` cru, sem `tenantId`, fora de `TENANT_MODELS`. Não copie preço por empresa.
- `TenantCeasaLink`, `TenantCeasaLinkRecusa`, `TenantCeasaAlerta`, `TenantBoletimEnviado` têm `tenantId` e estão em `TENANT_MODELS`. São a única superfície onde vazar entre clientes é possível; toda consulta a elas leva o `tenantId` da sessão (`tests/integration/cotacoes-vinculo.test.ts` guarda).

### Fonte

- `FonteDeCotacao.buscar` faz I/O; `parse(corpo)` é **puro** e testado contra fixture real (`tests/fixtures/cotacoes/<fonte>-ok.html`, `-vazio.html`, `-erro.html`). Adaptador novo traz as três fixtures.
- Contrato: nunca lança para o chamador; devolve `ResultadoDaFonte`.
- Três estados: `ok: true` com linhas / `ok: true, vazio: true` (dia sem boletim, não alarma) / `ok: false` (falha). Página **sem o marcador** esperado é **falha**, nunca vazio (ex.: `MARCADOR_BOLETIM` em `ceasaminas.ts`).
- Fonte nova = entrada em `FONTES` + linha em `ceasa_centrals`. `manual` não entra em `FONTES` (o cron pula).
- `buscarHtml` se identifica como `CeasaProBot/1.0`; fonte que recusa esse UA (CONAB: 403) precisa de decisão explícita no adaptador. `valeRepetir` não repete 4xx.
- Praça que publica só PDF (CEASA-RJ, SC, GO) **não** ganha adaptador: não há extrator de PDF no projeto.

### Série

- A série é função pura do `sourceKey`: `serieDaFonte` em `src/lib/cotacoes/serie.ts` (`conab` → `NACIONAL`, resto → `CENTRAL`). Toda leitura filtra por ela.
- Gravar cotação de outra série numa praça existente produz dado que nenhuma tela lê. Trocar o `sourceKey` de praça com histórico some com o histórico e cala os alertas salvos.

### Embalagem e peso

- `ceasa_quotes.unit` é texto livre da fonte (`KG`, `CX 30 DZ`, `DZ 4 KG`).
- No vínculo, `unit = NULL` é "qualquer embalagem"; `unit = ''` é embalagem real (praça manual sem a coluna). No `<select>`, "qualquer" usa valor-sentinela, nunca `""`.
- Peso em kg só quando a própria fonte declara no texto: `pesoEmKg` (`src/lib/cotacoes/embalagem.ts`) devolve `null` no resto. Não invente R$/kg.

### Vínculo

- Vínculo produto ↔ produto do boletim + embalagem é manual por desenho. `sugerirVinculos` só ordena.
- Nome idêntico é gravado sozinho por `autoVincularIdenticos`, **exceto** produto com recusa: `desvincular` grava `TenantCeasaLinkRecusa`; vincular à mão a apaga.

### Alerta

- Alerta (`CotacoesAlertasService`) é por produto **e** embalagem e **nunca** é criado automaticamente — o push diário dispara com qualquer aviso pendente, e alerta automático o tornaria diário para sempre.

### Publicação manual

- Colagem do super-admin em praça automática só entra em dia que a busca não trouxe (`CotacoesImportService.conferirColagemManual`).
- Envio do cliente vai para a fila `tenant_boletins_enviados` (`cotacoes-envio.service.ts`), não para a tabela global; o super-admin publica em `/admin/cotacoes`. Desfazer publicação: `CotacoesImportService.apagarBoletim`.
- A tela mostra `MAX(quoteDate)`: dado ruim em praça manual fica até chegar boletim posterior.

### Cron

- Importação: `CotacoesImportService.importarTodasAsCentrais` como sub-tarefa do cron de billing (13:30 BRT). Ver skill `cobranca`.
