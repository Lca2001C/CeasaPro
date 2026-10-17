import { normalizarNome } from "@/lib/cotacoes/nome";

/**
 * O que entra no CeasaNews — função PURA, testada em `tests/unit/noticias-filtro.test.ts`.
 *
 * Os feeds de site são gerais (soja, boi, juros, aviação); o que interessa a
 * quem vende hortifruti no box é bem mais estreito. A regra:
 *
 *  - termo FORTE (CEASA, hortifruti, hortaliça…) entra sozinho;
 *  - fora isso, precisa ter ALIMENTO de balcão (tomate, batata, fruta, verdura…)
 *    junto de algo que mexe no preço dele: preço, clima, transporte ou safra.
 *    "Batata" sozinha é receita de jantar; "geada" sozinha pode ser no café.
 *  - termo NEGATIVO (futebol, receita culinária…) derruba.
 *
 * A comparação é por palavra normalizada (sem acento, minúscula) e no singular
 * ingênuo (tira o "s" final), para "preços"/"preço" e "frutas"/"fruta" casarem.
 */

export const TEMAS = ["CEASA", "PRECOS", "CLIMA", "LOGISTICA", "SAFRA", "ECONOMIA"] as const;
export type Tema = (typeof TEMAS)[number];

export interface Classificacao {
  aceita: boolean;
  temas: Tema[];
  pontuacao: number;
}

const FORTES = [
  "ceasa", "ceagesp", "ceasaminas", "hortifruti", "hortifrutigranjeiro", "hortalica",
  "hortifrutícola", "central de abastecimento", "mercado atacadista", "prohort", "hf brasil",
  "feira livre", "sacolao", "varejao",
];

const ALIMENTOS = [
  "alimento", "comida", "cesta basica", "fruta", "verdura", "legume", "folhosa",
  "tomate", "batata", "cebola", "alface", "cenoura", "beterraba", "repolho", "couve",
  "chuchu", "abobrinha", "abobora", "pimentao", "pepino", "berinjela", "quiabo", "mandioca",
  "aipim", "inhame", "alho", "brocolis", "banana", "laranja", "maca", "mamao", "melancia",
  "melao", "manga", "limao", "uva", "morango", "abacate", "abacaxi", "tangerina", "mexerica",
  "goiaba", "maracuja", "ovo", "milho verde",
];

const PRECO = [
  "preco", "cotacao", "custo", "carestia", "encarece", "encarecer", "barateia", "baratear",
  "dispara", "disparam", "sobe", "sobem", "alta", "cai", "caem", "queda", "recuo", "oferta",
  "demanda", "abastecimento", "escassez", "falta", "valorizacao", "desvalorizacao", "caro",
  "barato", "consumidor", "feira",
];

const CLIMA = [
  "geada", "seca", "estiagem", "chuva", "granizo", "frio", "onda de calor", "calor", "el nino",
  "la nina", "enchente", "inundacao", "temporal", "tempestade", "clima", "climatica",
  "previsao do tempo", "massa de ar",
];

const LOGISTICA = [
  "frete", "diesel", "combustivel", "greve", "caminhoneiro", "rodovia", "bloqueio", "pedagio",
  "transporte", "logistica", "porto",
];

const SAFRA = [
  "safra", "colheita", "plantio", "producao", "produtor", "entressafra", "lavoura", "conab",
  "lspa", "area plantada", "praga", "doenca",
];

const ECONOMIA = [
  "inflacao", "ipca", "ipca 15", "igp m", "deflacao", "selic", "juros", "dolar", "cambio",
  "exportacao", "importacao", "cepea", "fgv", "ibge",
];

const NEGATIVOS = [
  "futebol", "campeonato", "novela", "bbb", "big brother", "horoscopo", "loteria", "mega sena",
  "receita de", "receitas de", "como fazer", "passo a passo", "celebridade", "show",
];

/** Singular ingênuo: "precos" → "preco", "frutas" → "fruta". */
const singular = (p: string) => (p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p);

function preparar(texto: string): { palavras: Set<string>; frase: string } {
  const normal = normalizarNome(texto);
  const lista = normal.split(" ").filter(Boolean).map(singular);
  return { palavras: new Set(lista), frase: ` ${lista.join(" ")} ` };
}

function quantos(alvo: ReturnType<typeof preparar>, termos: readonly string[]): number {
  let n = 0;
  for (const t of termos) {
    const termo = normalizarNome(t).split(" ").map(singular).join(" ");
    const casa = termo.includes(" ") ? alvo.frase.includes(` ${termo} `) : alvo.palavras.has(termo);
    if (casa) n++;
  }
  return n;
}

export function classificar(titulo: string, resumo = ""): Classificacao {
  const alvo = preparar(`${titulo} ${resumo}`);
  // O título pesa mais: notícia que só cita "tomate" no 5º parágrafo do resumo
  // é sobre outra coisa.
  const noTitulo = preparar(titulo);

  if (quantos(alvo, NEGATIVOS) > 0) return { aceita: false, temas: [], pontuacao: 0 };

  const fortes = quantos(alvo, FORTES);
  const alimentos = quantos(alvo, ALIMENTOS);
  const preco = quantos(alvo, PRECO);
  const clima = quantos(alvo, CLIMA);
  const logistica = quantos(alvo, LOGISTICA);
  const safra = quantos(alvo, SAFRA);
  const economia = quantos(alvo, ECONOMIA);

  const mexeNoPreco = preco + clima + logistica + safra + economia > 0;
  const aceita = fortes > 0 || (alimentos > 0 && mexeNoPreco);
  if (!aceita) return { aceita: false, temas: [], pontuacao: 0 };

  const temas: Tema[] = [];
  if (fortes > 0) temas.push("CEASA");
  if (preco > 0 && (alimentos > 0 || fortes > 0)) temas.push("PRECOS");
  if (clima > 0) temas.push("CLIMA");
  if (logistica > 0) temas.push("LOGISTICA");
  if (safra > 0) temas.push("SAFRA");
  if (economia > 0) temas.push("ECONOMIA");

  const pontuacao =
    fortes * 5 +
    alimentos * 2 +
    preco +
    clima +
    logistica +
    safra +
    economia +
    (quantos(noTitulo, FORTES) + quantos(noTitulo, ALIMENTOS)) * 3;

  return { aceita, temas, pontuacao };
}

/**
 * A notícia fala de algum produto da empresa? Compara pela primeira palavra do
 * nome do produto (a "família": "Tomate Italiano" → "tomate"), a mesma régua
 * de `agruparPorPrimeiraPalavra` nas Cotações.
 */
export function familiasCitadas(texto: string, familias: readonly string[]): string[] {
  const alvo = preparar(texto);
  return familias.filter((f) => {
    const chave = singular(normalizarNome(f));
    return chave.length >= 3 && alvo.palavras.has(chave);
  });
}

/** Título normalizado, para reconhecer a mesma matéria chegando por dois feeds. */
export function chaveDoTitulo(titulo: string): string {
  return normalizarNome(titulo).slice(0, 120);
}
