import { paraNumero, type Numerico } from "@/lib/numero";

/**
 * Quanto ainda dá para vender de um produto.
 *
 * Regra única, usada no Estoque e no PDV — os dois precisam concordar sobre o
 * que é "acabando", senão a lista avisa e a frente de caixa não (ou o contrário).
 */
export type NivelEstoque = "zerado" | "acabando" | "ok";

/**
 * Abaixo disto o produto entra em alerta.
 *
 * É um número absoluto de propósito: giro por produto exigiria histórico e uma
 * conta que o operador não consegue conferir de cabeça. No CEASA, "menos de 5"
 * é o suficiente para lembrar de repor antes de faltar no meio do dia.
 */
export const ESTOQUE_BAIXO = 5;

/**
 * @param minimo Alerta de estoque do PRODUTO (`Product.minStock`), quando o dono
 *   cadastrou um. Nulo cai no `ESTOQUE_BAIXO` global. Com mínimo, "acabando" é
 *   chegar NELE (≤), que é como o dono lê "me avise quando tiver 10".
 */
export function nivelEstoque(quantidade: Numerico, minimo?: Numerico | null): NivelEstoque {
  const q = milesimos(quantidade);
  // Saldo negativo (ajuste manual, movimento fora de ordem) conta como zerado:
  // não há o que vender, e mostrar "-2 caixas" como se fosse estoque confunde.
  if (q <= 0) return "zerado";
  if (minimo != null) {
    return q <= milesimos(minimo) ? "acabando" : "ok";
  }
  if (q < ESTOQUE_BAIXO * 1000) return "acabando";
  return "ok";
}

/**
 * Casas decimais da quantidade — o mesmo do banco (`Decimal(14, 3)`).
 *
 * Comparar além disso é comparar ruído de ponto flutuante: uma quantidade
 * montada no browser como `0.1 + 0.2` chega valendo `0.30000000000000004`, e
 * sem arredondar o PDV acusaria falta de estoque numa venda que cabe.
 */
const CASAS_QUANTIDADE = 3;

/**
 * Quantidade em MILÉSIMOS inteiros — as 3 casas do banco, sem Decimal (ver
 * `src/lib/numero.ts`: isto roda no PDV, no navegador). Inteiro até 9 × 10¹⁵ é
 * exato em `number`, muito além de `Decimal(14, 3)`. Arredonda meio para longe
 * do zero, como o `ROUND_HALF_UP` do Decimal que estava aqui antes.
 */
function milesimos(v: Numerico): number {
  const n = paraNumero(v) * 10 ** CASAS_QUANTIDADE;
  return Math.sign(n) * Math.round(Math.abs(n));
}

/** Vender `pedido` deixaria o saldo negativo? */
export function passaDoEstoque(disponivel: Numerico, pedido: Numerico): boolean {
  return milesimos(pedido) > milesimos(disponivel);
}

/** Saldo que sobra depois de vender `pedido` (pode ficar negativo — é o aviso). */
export function saldoApos(disponivel: Numerico, pedido: Numerico): number {
  return (milesimos(disponivel) - milesimos(pedido)) / 10 ** CASAS_QUANTIDADE;
}
