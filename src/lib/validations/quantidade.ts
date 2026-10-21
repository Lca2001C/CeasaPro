/**
 * Limites de quantidade e preço de mercadoria (venda, compra, ajuste).
 *
 * As colunas são `Decimal(14,3)` (quantidade) e `Decimal(14,2)` (dinheiro): o
 * banco ARREDONDA o que passar disso, e a conta feita antes não. Quantidade
 * 0,0004 gravava 0,000 na baixa de estoque e cobrava 0,0004 × preço; duas
 * linhas de 1,0005 passavam pela checagem de saldo (2,001) e gravavam 2,002 —
 * estoque −0,001. E um número gigante estourava a coluna como 500 genérico em
 * vez de voltar 400 com o campo marcado.
 */

/** Teto de quantidade por linha — muito além de qualquer box, longe do limite da coluna. */
export const QUANTIDADE_MAX = 1_000_000;
/** Teto de preço unitário, frete ou custo. */
export const VALOR_MAX = 10_000_000;
/** Teto de linhas numa venda ou compra (um carrinho de balcão tem dezenas). */
export const ITENS_MAX = 200;

export const MSG_TRES_CASAS = "Use no máximo 3 casas decimais";
export const MSG_QUANTIDADE_MAX = "Quantidade muito alta — confira o número";
export const MSG_VALOR_MAX = "Valor muito alto — confira o número";
export const MSG_ITENS_MAX = `No máximo ${ITENS_MAX} itens por lançamento`;

/** Quantidade com até 3 casas (tolerância para o ruído de ponto flutuante). */
export function temAteTresCasas(v: number): boolean {
  return Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
}

/** Custo unitário com até 4 casas (a coluna de custo é `Decimal(14,4)`). */
export function temAteQuatroCasas(v: number): boolean {
  return Math.abs(v * 10000 - Math.round(v * 10000)) < 1e-6;
}
