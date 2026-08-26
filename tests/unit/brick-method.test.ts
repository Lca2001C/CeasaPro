import { describe, it, expect } from "vitest";
import { normalizarMetodoBrick } from "@/lib/payments/brick-method";

/**
 * O SDK do Mercado Pago declara os identificadores em camelCase, mas emite
 * snake_case em runtime. Comparar com o literal do tipo derrubava todo cartão
 * em "forma de pagamento não disponível" — e o compilador não acusava nada,
 * porque o tipo dizia que camelCase estava certo. Daí este teste.
 */
describe("normalizarMetodoBrick", () => {
  it("aceita o que o SDK DECLARA (camelCase)", () => {
    expect(normalizarMetodoBrick("creditCard")).toBe("CREDIT_CARD");
    expect(normalizarMetodoBrick("debitCard")).toBe("DEBIT_CARD");
    expect(normalizarMetodoBrick("bank_transfer")).toBe("PIX");
  });

  it("aceita o que o SDK EMITE (snake_case) — o caso que quebrava", () => {
    expect(normalizarMetodoBrick("credit_card")).toBe("CREDIT_CARD");
    expect(normalizarMetodoBrick("debit_card")).toBe("DEBIT_CARD");
  });

  it("trata cartão pré-pago como crédito", () => {
    expect(normalizarMetodoBrick("prepaidCard")).toBe("CREDIT_CARD");
    expect(normalizarMetodoBrick("prepaid_card")).toBe("CREDIT_CARD");
  });

  it("usa o primeiro candidato reconhecível", () => {
    // selectedPaymentMethod vazio, paymentType preenchido.
    expect(normalizarMetodoBrick(undefined, "credit_card")).toBe("CREDIT_CARD");
    expect(normalizarMetodoBrick("", null, "debitCard")).toBe("DEBIT_CARD");
  });

  it("devolve null para o que não sabemos cobrar", () => {
    expect(normalizarMetodoBrick("ticket")).toBeNull();
    expect(normalizarMetodoBrick("atm")).toBeNull();
    expect(normalizarMetodoBrick("wallet_purchase")).toBeNull();
    expect(normalizarMetodoBrick(undefined, null, "")).toBeNull();
  });
});
