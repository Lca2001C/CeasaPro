/** Forma de pagamento aceita na mensalidade, no vocabulário do nosso domínio. */
export type MetodoMensalidade = "PIX" | "CREDIT_CARD" | "DEBIT_CARD";

/**
 * Traduz o identificador de forma de pagamento do Payment Brick para o nosso enum.
 *
 * O SDK **declara** os valores em camelCase (`creditCard`, `debitCard`), mas em
 * runtime emite snake_case (`credit_card`, `debit_card`) — os tipos do pacote
 * estão atrasados em relação ao script que roda dentro do iframe. Comparar com o
 * literal do tipo fazia todo pagamento com cartão cair em "forma de pagamento
 * não disponível para a mensalidade"; o PIX escapava por acaso, porque
 * `bank_transfer` se escreve igual nos dois estilos.
 *
 * Normalizar aceita as duas grafias, então funciona hoje e continua funcionando
 * quando o SDK acertar os tipos. Cartão pré-pago entra como crédito: é assim que
 * o Mercado Pago o processa e é o que o nosso `ChargeMethod` comporta.
 *
 * Recebe vários candidatos (`selectedPaymentMethod`, `paymentType`) e usa o
 * primeiro que reconhecer.
 */
export function normalizarMetodoBrick(
  ...valores: (string | undefined | null)[]
): MetodoMensalidade | null {
  for (const valor of valores) {
    if (!valor) continue;
    // Descarta separadores e caixa: "credit_card", "creditCard" e
    // "CREDIT-CARD" chegam todos em "creditcard".
    const chave = valor.replace(/[^a-z]/gi, "").toLowerCase();
    if (chave === "banktransfer" || chave === "pix") return "PIX";
    if (chave === "creditcard" || chave === "prepaidcard") return "CREDIT_CARD";
    if (chave === "debitcard") return "DEBIT_CARD";
  }
  return null;
}
