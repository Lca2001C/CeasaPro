import { toDecimal, type Numeric } from "@/lib/money";

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

export function nivelEstoque(quantidade: Numeric): NivelEstoque {
  const q = toDecimal(quantidade);
  // Saldo negativo (ajuste manual, movimento fora de ordem) conta como zerado:
  // não há o que vender, e mostrar "-2 caixas" como se fosse estoque confunde.
  if (q.lessThanOrEqualTo(0)) return "zerado";
  if (q.lessThan(ESTOQUE_BAIXO)) return "acabando";
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

function quantidade(v: Numeric) {
  return toDecimal(v).toDecimalPlaces(CASAS_QUANTIDADE);
}

/** Vender `pedido` deixaria o saldo negativo? */
export function passaDoEstoque(disponivel: Numeric, pedido: Numeric): boolean {
  return quantidade(pedido).greaterThan(quantidade(disponivel));
}

/** Saldo que sobra depois de vender `pedido` (pode ficar negativo — é o aviso). */
export function saldoApos(disponivel: Numeric, pedido: Numeric) {
  return quantidade(disponivel).minus(quantidade(pedido));
}
