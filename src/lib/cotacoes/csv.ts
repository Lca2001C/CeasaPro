/**
 * Boletim colado como texto.
 *
 * Isto é a escotilha do módulo: no dia em que a fonte mudar de formato e o
 * parser quebrar, alguém abre o painel, cola o boletim e o módulo continua de
 * pé enquanto o adaptador é consertado. Sem ela, uma mudança no site da central
 * derruba o produto até alguém ter tempo de programar.
 *
 * É texto colado e não upload de arquivo de propósito: o projeto não tem nenhum
 * handler de multipart, e um `<textarea>` atravessa o caminho que já existe
 * (action + Zod + JSON) sem inventar infraestrutura para isso.
 *
 * Sem imports: é função pura, testada sozinha.
 */

export interface LinhaDeCotacao {
  produto: string;
  unidade: string;
  minimo: number | null;
  comum: number | null;
  maximo: number | null;
  /** O preço que a tela mostra. Ver `CeasaQuote.refPrice`. */
  referencia: number;
}

export interface ResultadoDoCsv {
  linhas: LinhaDeCotacao[];
  /** Erros por linha, com o número da linha como a pessoa a vê (1-based). */
  erros: { linha: number; motivo: string }[];
}

/**
 * Número no formato brasileiro.
 *
 * "1.234,56" e "1234.56" precisam funcionar os dois: quem copia da planilha traz
 * vírgula, quem exporta de sistema traz ponto. A regra é: se tem vírgula, ela é
 * o decimal e o ponto é milhar.
 */
function numero(bruto: string): number | null {
  const limpo = bruto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * `produto;unidade;minimo;comum;maximo`
 *
 * Aceita `;` ou tabulação como separador — colar direto do Excel traz tabulação.
 * Linha em branco é ignorada; linha malformada entra em `erros` em vez de
 * derrubar a importação inteira, porque perder um boletim de 300 linhas por
 * causa de uma linha suja seria o pior dos dois mundos.
 */
export function lerCsvDeCotacoes(texto: string): ResultadoDoCsv {
  const linhas: LinhaDeCotacao[] = [];
  const erros: { linha: number; motivo: string }[] = [];

  const cruas = texto.split(/\r?\n/);
  for (let i = 0; i < cruas.length; i++) {
    const crua = cruas[i]!.trim();
    if (!crua) continue;

    const campos = crua.split(/[;\t]/).map((c) => c.trim());
    // Cabeçalho: quem cola da planilha traz a primeira linha com os títulos.
    if (i === 0 && /produto/i.test(campos[0] ?? "")) continue;

    const [produto, unidade, min, comum, max] = campos;
    if (!produto) {
      erros.push({ linha: i + 1, motivo: "sem nome de produto" });
      continue;
    }

    const minimo = numero(min ?? "");
    const medio = numero(comum ?? "");
    const maximo = numero(max ?? "");

    // O preço de referência é o COMUM quando existe; senão o meio da faixa;
    // senão o único que veio. Uma linha sem preço nenhum não é cotação.
    const referencia =
      medio ??
      (minimo !== null && maximo !== null ? (minimo + maximo) / 2 : (minimo ?? maximo));
    if (referencia === null) {
      erros.push({ linha: i + 1, motivo: "sem preço" });
      continue;
    }

    linhas.push({
      produto,
      unidade: unidade ?? "",
      minimo,
      comum: medio,
      maximo,
      referencia: Math.round(referencia * 100) / 100,
    });
  }

  return { linhas, erros };
}
