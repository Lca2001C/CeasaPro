/**
 * Nomes de produto entre o boletim do CEASA e o cadastro do cliente.
 *
 * O cliente escreve "Tomate". O boletim imprime "TOMATE SALADA LONGA VIDA".
 * Nenhuma normalização faz esses dois virarem o mesmo texto, e é por isso que o
 * vínculo entre eles é MANUAL — feito uma vez pelo dono, guardado em
 * `TenantCeasaLink`.
 *
 * O que existe aqui, então, é o que ajuda essa escolha sem tomá-la:
 *
 *   1. `slugProduto` dá identidade estável ao produto do boletim, para o
 *      catálogo não ganhar uma linha nova todo dia porque a fonte imprimiu dois
 *      espaços ou trocou a caixa.
 *   2. `sugerirVinculos` ordena candidatos para a tela mostrar os mais
 *      prováveis primeiro. Ela devolve uma LISTA, sempre — nunca "o certo".
 *
 * A tentação óbvia é casar por similaridade (trigrama, distância de edição) e
 * poupar o clique. Isso casaria "TOMATE CEREJA" com "TOMATE SALADA", que são
 * produtos diferentes com preços diferentes, e o cliente repassaria o preço
 * errado achando que era o certo. Num módulo cujo propósito é orientar preço,
 * errar em silêncio é pior que não responder.
 *
 * Sem imports: roda no servidor e no navegador.
 */

/**
 * Forma canônica de um nome, para comparação.
 *
 * Minúsculas → separa os acentos (NFD) e os descarta → tudo que não é letra,
 * número ou espaço vira espaço → colapsa espaços. "Tomate  Salada (LONGA-VIDA)"
 * e "TOMATE SALADA LONGA VIDA" chegam ao mesmo texto.
 */
export function normalizarNome(bruto: string): string {
  return bruto
    .normalize("NFD")
    // Marcas de combinação (o acento que o NFD separou da letra). Escapado de
    // propósito: com os caracteres literais, um editor ou um `sed` que
    // normalizasse o arquivo apagaria a classe sem deixar rastro.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Identidade do produto no catálogo do boletim.
 *
 * É `@unique` no banco: é isto que faz reimportar o mesmo boletim atualizar em
 * vez de duplicar.
 */
export function slugProduto(nome: string): string {
  return normalizarNome(nome).replace(/ /g, "-");
}

/** Palavras significativas de um nome, sem as vazias. */
function tokens(nome: string): string[] {
  // "de", "da", "do" aparecem em "batata doce" e "alface de folha" sem
  // distinguir nada; mantê-las inflaria a semelhança entre produtos diferentes.
  const VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "com", "em", "a", "o"]);
  return normalizarNome(nome)
    .split(" ")
    .filter((t) => t.length > 0 && !VAZIAS.has(t));
}

export interface CandidatoDeVinculo<T> {
  item: T;
  /** 0 a 1. Só ordena a lista — NÃO é limiar de decisão. */
  escore: number;
}

/**
 * Ordena os produtos do boletim por probabilidade de serem o produto do cliente.
 *
 * A ordem das regras é o que importa:
 *   - nome idêntico depois de normalizar → 1
 *   - o nome do cliente é o começo do nome do boletim ("Tomate" ⊂ "Tomate
 *     Salada") → alto, porque é o padrão real do CEASA: o boletim detalha o que
 *     o cliente abrevia
 *   - todas as palavras do cliente aparecem no boletim → médio
 *   - sobreposição parcial de palavras → proporcional
 *
 * `limite` corta a lista para a tela, não a decisão: o formulário sempre oferece
 * busca livre em cima disso.
 */
export function sugerirVinculos<T>(
  nomeDoCliente: string,
  candidatos: T[],
  nomeDe: (c: T) => string,
  limite = 5,
): CandidatoDeVinculo<T>[] {
  const alvo = normalizarNome(nomeDoCliente);
  if (!alvo) return [];
  const alvoTokens = tokens(nomeDoCliente);

  const pontuados = candidatos.map((item) => {
    const nome = normalizarNome(nomeDe(item));
    let escore = 0;

    if (nome === alvo) {
      escore = 1;
    } else if (nome.startsWith(alvo + " ")) {
      escore = 0.9;
    } else if (alvo.startsWith(nome + " ")) {
      escore = 0.8;
    } else {
      const doCandidato = new Set(tokens(nomeDe(item)));
      const emComum = alvoTokens.filter((t) => doCandidato.has(t)).length;
      if (emComum > 0) {
        // Divide pelo MAIOR dos dois conjuntos: sem isso, "Tomate" teria escore
        // 1 contra "Tomate Cereja", "Tomate Salada" e todos os outros, e a
        // ordem entre eles viraria acaso.
        escore = (0.7 * emComum) / Math.max(alvoTokens.length, doCandidato.size);
      }
    }

    return { item, escore };
  });

  return pontuados
    .filter((p) => p.escore > 0)
    .sort((a, b) => b.escore - a.escore)
    .slice(0, limite);
}
