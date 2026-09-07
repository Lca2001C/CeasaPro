/**
 * Trava de segurança: nenhum teste faz requisição HTTP para fora.
 *
 * O módulo de cotações raspa um site público de terceiro. Sem esta trava, um
 * teste que chamasse `ceasaminas.buscar()` por engano passaria a discar para
 * `minas1.ceasa.mg.gov.br` a cada execução da suíte — e aí:
 *
 *   - a suíte fica dependente de rede, e vermelha quando a fonte cai (que é o
 *     evento normal que o módulo existe para tolerar);
 *   - o tempo do CI passa a depender de um servidor legado que não nos deve nada;
 *   - marteláramos um serviço público a cada `git push`.
 *
 * O parsing é testado contra os arquivos de `tests/fixtures/cotacoes`, que são
 * respostas REAIS capturadas uma vez — é para isso que `FonteDeCotacao` separa
 * `buscar` (I/O) de `parse` (puro).
 *
 * Localhost continua liberado: os testes de integração falam com o Postgres e o
 * E2E com o servidor Next.
 *
 * Mesma forma e mesmo raciocínio de `no-outbound-email.ts`.
 */
const fetchOriginal = globalThis.fetch;

const LOCAIS = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|$)/i;

function ehLocal(url: string): boolean {
  try {
    return LOCAIS.test(new URL(url).host);
  } catch {
    // Caminho relativo (`/api/...`) só existe no contexto do próprio servidor.
    return true;
  }
}

globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof entrada === "string"
      ? entrada
      : entrada instanceof URL
        ? entrada.toString()
        : entrada.url;

  if (!ehLocal(url)) {
    // Promise REJEITADA, não `throw` síncrono: o `fetch` de verdade nunca lança
    // na chamada, e um throw síncrono aqui quebraria de forma diferente do real
    // — código escrito como `fetch(...).catch(...)` estouraria antes de chegar
    // ao `.catch`, e o teste passaria a medir o comportamento da trava em vez do
    // comportamento do código.
    return Promise.reject(
      new Error(
        `Teste tentou acessar a rede: ${url}\n` +
          "Nenhum teste pode depender de servidor externo. Use um fixture de " +
          "`tests/fixtures/` e chame a função pura de parsing, ou injete uma fonte " +
          "falsa no serviço (ver `tests/integration/cotacoes-importador.test.ts`).",
      ),
    );
  }

  return fetchOriginal(entrada as RequestInfo, init);
}) as typeof fetch;
