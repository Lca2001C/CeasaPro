/** Cobrança PIX como a tela precisa dela (o que a API de checkout devolve). */
export interface PixCharge {
  /** Copia-e-cola (payload EMV). É o que sempre dá para pagar, mesmo sem imagem. */
  qrCode: string | null;
  /** PNG do QR Code em base64, quando o Mercado Pago envia. */
  qrCodeBase64: string | null;
  /** Página do Mercado Pago com o QR — reserva quando não veio a imagem. */
  ticketUrl: string | null;
  amount: string;
  /** Validade do código (48h por padrão). */
  expiresAt?: string | Date | null;
}

/**
 * A cobrança tem como ser paga?
 *
 * A tela antiga só trocava para o painel do PIX quando havia `qrCodeBase64`.
 * Quando o Mercado Pago devolvia só o copia-e-cola (ou só a `ticketUrl`), o
 * painel nunca aparecia e o cliente ficava parado na tela do Brick, que manda
 * procurar o código no e-mail. Basta **um** dos três para conseguir pagar.
 */
export function temPagamentoPix(charge: PixCharge | null | undefined): boolean {
  if (!charge) return false;
  return Boolean(charge.qrCodeBase64 || charge.qrCode || charge.ticketUrl);
}
