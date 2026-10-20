/**
 * `stock_movements.sourceType`: de onde veio cada linha do livro-razão.
 *
 * Constantes num lugar só porque o SQL do custo médio (`sqlCustoEstoque`)
 * reconhece duas delas pelo texto — uma digitação diferente em um dos lados
 * faria a compra cancelada voltar a pesar na média sem nada acusar.
 */
export const ORIGEM_COMPRA = "PURCHASE";
/** Estorno da compra cancelada: anula a ENTRADA dela, quantidade e custo. */
export const ORIGEM_COMPRA_CANCELADA = "PURCHASE_CANCELLED";
export const ORIGEM_VENDA = "SALE";
/** Devolução da venda cancelada ao estoque, pelo custo com que a mercadoria saiu. */
export const ORIGEM_VENDA_CANCELADA = "SALE_CANCELLED";
