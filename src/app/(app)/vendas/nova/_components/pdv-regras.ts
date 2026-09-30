/**
 * Regras puras da frente de caixa, fora do componente para poderem ser
 * testadas sem montar a tela.
 *
 * Nada aqui importa `zod` nem `@/lib/validations/venda`: o PDV não arrasta o
 * schema para o bundle do navegador (ver o cabeçalho de `lib/venda/total`).
 * Onde a regra ESPELHA um refine do servidor, `tests/unit/pdv-regras.test.ts`
 * confere as duas lado a lado — se o schema mudar, o teste quebra.
 */
import { paraCentavos, paraEscala, paraMilesimos, ESCALA_QUANTIDADE } from "@/lib/venda/total";

// ── Quantidade ──────────────────────────────────────────────────────────

/** Milésimos inteiros de volta para `number`, pela string — sem ruído de float. */
function milesimosParaNumero(milesimos: bigint): number {
  const negativo = milesimos < 0n;
  const absoluto = (negativo ? -milesimos : milesimos)
    .toString()
    .padStart(ESCALA_QUANTIDADE + 1, "0");
  const corte = absoluto.length - ESCALA_QUANTIDADE;
  return Number(`${negativo ? "-" : ""}${absoluto.slice(0, corte)}.${absoluto.slice(corte)}`);
}

/**
 * Soma de quantidades em milésimos inteiros (3 casas, como `Decimal(14,3)`).
 *
 * Era `Math.round(v * 100) / 100`: 2,345 kg + 1,25 kg virava 3,6 kg, e a venda
 * cobrava e baixava do estoque 5 gramas que ninguém pesou.
 */
export function somarQuantidade(a: number, b: number): number {
  return milesimosParaNumero(paraMilesimos(a) + paraMilesimos(b));
}

/** `a − b` em milésimos inteiros. */
export function subtrairQuantidade(a: number, b: number): number {
  return milesimosParaNumero(paraMilesimos(a) - paraMilesimos(b));
}

// ── Desconto do item ────────────────────────────────────────────────────

/** Casas com que as entradas são lidas para o bruto exato. */
const ESCALA_EXATA = 10;

/**
 * O maior desconto que a linha aceita, em centavos: o bruto EXATO
 * (quantidade × preço, em precisão cheia) truncado no centavo.
 *
 * Truncado, e não arredondado: com 2,345 kg a R$ 3,00 o bruto é 7,035. O
 * arredondado (7,04) deixaria a linha em −0,005, que o servidor grava como
 * −R$ 0,01. Com 7,03 a linha fica em 0,005 → R$ 0,01, nunca negativa, e o
 * valor cabe no refine do servidor (`desconto <= bruto arredondado`).
 */
export function descontoMaximoDoItemCents(item: { quantity: number; unitPrice: number }): bigint {
  if (!(item.quantity > 0) || !(item.unitPrice > 0)) return 0n;
  const produto = paraEscala(item.quantity, ESCALA_EXATA) * paraEscala(item.unitPrice, ESCALA_EXATA);
  // escala 20 → escala 2: divisão inteira de positivos já é o truncamento.
  return produto / 10n ** BigInt(2 * ESCALA_EXATA - 2);
}

// ── Troco ───────────────────────────────────────────────────────────────

/**
 * Teto do troco, em centavos — o mesmo `TROCO_MAXIMO_CENTS` de
 * `validations/venda`: o troco não passa do maior entre R$ 500 e a própria
 * parte paga em espécie.
 */
export const TROCO_MAXIMO_CENTS = 50_000n;

/** O troco passaria do teto que o servidor aceita? */
export function trocoPassaDoTeto(recebidoCents: bigint, emEspecieCents: bigint): boolean {
  const teto = emEspecieCents > TROCO_MAXIMO_CENTS ? emEspecieCents : TROCO_MAXIMO_CENTS;
  return recebidoCents - emEspecieCents > teto;
}

/**
 * O que a caixa "Cliente pagou com" mostra: troco ou falta, sempre contra a
 * parte EM DINHEIRO — a mesma régua do `validar()` e do servidor.
 */
export function trocoOuFalta(
  recebido: number,
  emEspecieCents: bigint,
): { tipo: "troco" | "falta"; cents: bigint } {
  const diferenca = paraCentavos(recebido) - emEspecieCents;
  return diferenca < 0n ? { tipo: "falta", cents: -diferenca } : { tipo: "troco", cents: diferenca };
}

// ── Caixas plásticas ────────────────────────────────────────────────────

/**
 * Espelho de `resolvePlasticCrateQty` (validations/venda) para o que o PDV
 * envia: o número do checkbox, se houver, ou a soma das linhas com vasilhame
 * "Caixa plástica". O servidor exige cliente sempre que isto passa de zero.
 */
export function caixasPlasticasDaVenda(
  plasticCrateQty: number | undefined,
  itens: readonly { recipientType?: string | null; crateQty?: number | null }[],
): number {
  if (plasticCrateQty != null && plasticCrateQty > 0) return plasticCrateQty;
  return itens.reduce(
    (total, i) => total + (i.recipientType === "PLASTICA" ? (i.crateQty ?? 0) : 0),
    0,
  );
}

// ── Busca ───────────────────────────────────────────────────────────────

/**
 * Texto de busca sem acento e sem caixa: "limao" acha "Limão". No teclado do
 * celular o acento pede toque longo, e quase ninguém digita.
 */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

// ── Erro do servidor ────────────────────────────────────────────────────

/**
 * A mensagem a mostrar para uma resposta de erro.
 *
 * Falha de schema chega como `message: "Dados inválidos"` e o motivo de verdade
 * em `fields` ("Informe o cliente para controlar as caixas plásticas"). Mostrar
 * só a `message` deixava o operador sem saber o que corrigir.
 */
export function mensagemDoErro(error: {
  code: string;
  message: string;
  fields?: Record<string, string>;
}): string {
  if (error.code === "VALIDATION" && error.fields) {
    const primeira = Object.values(error.fields).find((m) => typeof m === "string" && m.trim());
    if (primeira) return primeira;
  }
  return error.message;
}
