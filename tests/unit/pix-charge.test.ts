import { describe, it, expect } from "vitest";
import { temPagamentoPix, type PixCharge } from "@/lib/payments/pix-charge";

/**
 * A tela só trocava para o painel do PIX quando havia `qrCodeBase64`. Quando o
 * Mercado Pago devolvia apenas o copia-e-cola, o painel nunca aparecia e o
 * cliente ficava parado na tela do Brick — que manda procurar o código no
 * e-mail, e-mail que este fluxo não envia. Basta UM dos três para pagar.
 */
const base: PixCharge = {
  qrCode: null,
  qrCodeBase64: null,
  ticketUrl: null,
  amount: "49.90",
};

describe("temPagamentoPix", () => {
  it("aceita cobrança com a imagem do QR", () => {
    expect(temPagamentoPix({ ...base, qrCodeBase64: "aW1n" })).toBe(true);
  });

  it("aceita cobrança só com copia-e-cola — o caso que travava a tela", () => {
    expect(temPagamentoPix({ ...base, qrCode: "00020126580014BR.GOV.BCB.PIX" })).toBe(true);
  });

  it("aceita cobrança só com o link do comprovante", () => {
    expect(temPagamentoPix({ ...base, ticketUrl: "https://mp.com/ticket/1" })).toBe(true);
  });

  it("recusa cobrança sem nenhuma forma de pagar", () => {
    expect(temPagamentoPix(base)).toBe(false);
    expect(temPagamentoPix({ ...base, qrCode: "", qrCodeBase64: "" })).toBe(false);
  });

  it("recusa ausência de cobrança", () => {
    expect(temPagamentoPix(null)).toBe(false);
    expect(temPagamentoPix(undefined)).toBe(false);
  });
});
