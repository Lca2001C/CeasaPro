import type { SaleUnit } from "@prisma/client";

/**
 * A parte da embalagem que é só TEXTO — sem Decimal, sem Prisma.
 *
 * Separada de `embalagem.ts` porque o PDV e a tela de vínculo (componentes de
 * cliente) só precisam destas funções, e importar de lá arrastava o runtime do
 * Prisma e o Decimal para o navegador. `embalagem.ts` reexporta tudo.
 */

/**
 * A forma CANÔNICA de uma embalagem digitada: maiúsculas, espaço único, sem
 * sobra nas pontas. É a forma que os raspadores já produzem (as fontes publicam
 * em maiúsculas e `textoLimpo` colapsa espaço), e é o que o resto deste arquivo
 * já faz antes de comparar (`toUpperCase` em `pesoEmKg`/`embalagemCasaComVenda`).
 *
 * Existe porque a CHAVE da cotação — `(central, data, produto, unit)` — compara
 * o texto exato: "Kg" e "KG" colados em dois boletins de uma praça manual viravam
 * duas séries, e o vínculo gravado numa deixava de casar com a outra.
 *
 * `''` continua `''`: é uma embalagem real ("o boletim não trouxe a coluna"), e
 * não pode virar `null` — ver o comentário de `CeasaQuote.unit` no schema.
 * Aplicada só a ENTRADA nova (`lerCsvDeCotacoes`), nunca a dado já gravado.
 */
export function normalizarEmbalagem(unit: string | null | undefined): string {
  return (unit ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Sinônimos de cada unidade de venda do cliente no vocabulário do boletim.
 *
 * `KG` fica de fora porque é o único caso de igualdade exata (ver `casa`): a
 * cotação por quilo é a linha `KG`, e um prefixo aceitaria qualquer coisa que
 * comece com essas duas letras.
 */
const SIGLAS: Record<Exclude<SaleUnit, "KG">, string[]> = {
  CAIXA: ["CX", "CAIXA"],
  SACO: ["SC", "SACO", "SACA"],
  BANDEJA: ["BAND", "BDJ", "BJ"],
  UNIDADE: ["UN"],
};

/**
 * A embalagem do boletim fala da mesma coisa que a unidade de venda do cliente?
 *
 * Serve às telas de operação decidirem se MOSTRAM a referência. Um "R$ 4,20/KG"
 * ao lado do campo de preço de um produto vendido por CAIXA é pior que espaço
 * vazio: o número está certo, a leitura é errada, e o operador digita em cima
 * dele no balcão.
 *
 * Deliberadamente conservadora — só a afinidade de texto que a fonte publica.
 * Nada de peso, nada de conversão: aqui a pergunta é "é a mesma unidade?", não
 * "quanto dá se eu converter".
 */
export function embalagemCasaComVenda(
  unit: string | null | undefined,
  saleUnit: SaleUnit,
): boolean {
  const texto = (unit ?? "").trim().toUpperCase();
  if (!texto) return false;
  if (saleUnit === "KG") return texto === "KG";
  return SIGLAS[saleUnit].some((s) => texto.startsWith(s));
}

/**
 * Como a embalagem aparece na tela.
 *
 * Boletim manual pode vir sem embalagem (`unit` é `''`, e a coluna é NOT NULL de
 * propósito — ver o comentário de `CeasaQuote.unit` no schema). Mostrar a string
 * vazia deixaria um travessão solto depois do nome do produto; a frase diz o que
 * de fato aconteceu.
 */
export function rotuloDeEmbalagem(unit: string | null | undefined): string {
  const texto = (unit ?? "").trim();
  return texto || "sem embalagem informada";
}
