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
/** Ajuste manual (quebra, doação, acerto) lançado na tela de estoque. */
export const ORIGEM_AJUSTE = "MANUAL";
/**
 * Estorno do ajuste manual desfeito (até 24 h). `sourceId` = id do ajuste. O
 * par sai junto do repasse do custo médio, como o da compra cancelada.
 */
export const ORIGEM_AJUSTE_DESFEITO = "MANUAL_CANCELLED";
/**
 * Baixa do saldo na EXCLUSÃO do produto. Entra nas perdas do mês como o ajuste
 * manual, mas NÃO é desfazível: era `MANUAL`, aparecia na lista de "Desfazer"
 * e devolvia a mercadoria a um produto que nenhuma tela mostra — a perda e o
 * valor do estoque sumiam juntos.
 */
export const ORIGEM_PRODUTO_EXCLUIDO = "PRODUCT_DELETED";
/** Embalagem baixada sem ser vendida (quebra, uso) — `EmbalagensService.registrarBaixa`. */
export const ORIGEM_BAIXA_EMBALAGEM = "PACKAGING_LOSS";
/**
 * Estorno da baixa de embalagem desfeita (até 24 h). `sourceId` = id da baixa.
 * O par sai junto do custo médio do tipo e do custo das embalagens do mês.
 */
export const ORIGEM_BAIXA_EMBALAGEM_DESFEITA = "PACKAGING_LOSS_CANCELLED";
/**
 * Saldo antigo do tipo "Caixa plástica" passado para o estoque de caixas
 * (`EmbalagensService.transferirSaldoParaCaixas`). AJUSTE negativo no tipo;
 * `sourceId` = a ENTRADA de caixas criada, que por isso não se desfaz como
 * entrada manual.
 */
export const ORIGEM_TRANSFERIDO_PARA_CAIXAS = "PACKAGING_TO_CRATES";
