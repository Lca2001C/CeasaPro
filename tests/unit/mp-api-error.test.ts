import { describe, it, expect } from "vitest";
import { describeError } from "@/lib/logger";
import {
  MercadoPagoApiError,
  mercadoPagoErrorMessage,
} from "@/lib/payments/mercadopago";

/**
 * O SDK do Mercado Pago faz `throw await response.json()` — lança um objeto
 * puro, não um `Error`. Estes testes fixam o comportamento que impedia o
 * diagnóstico: o motivo da recusa precisa sobreviver até o log e até a tela.
 */
describe("describeError", () => {
  it("usa a message de um Error", () => {
    expect(describeError(new Error("falhou"))).toBe("falhou");
  });

  it("serializa objeto lançado que NÃO é Error (caso do SDK do Mercado Pago)", () => {
    const lancadoPeloSdk = {
      message: "Invalid users involved",
      error: "bad_request",
      status: 400,
      cause: [{ code: "2062", description: "Invalid users involved" }],
    };
    const out = describeError(lancadoPeloSdk);
    expect(out).not.toBe("[object Object]");
    expect(out).toContain("Invalid users involved");
    expect(out).toContain("2062");
  });

  it("não quebra com referência circular", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
    expect(describeError(circular)).not.toBe("[object Object]");
  });

  it("passa string adiante e lida com null/undefined", () => {
    expect(describeError("texto")).toBe("texto");
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
  });
});

describe("mercadoPagoErrorMessage", () => {
  function erro(message: string, status: number | null, causes: { code: string; description: string }[] = []) {
    return new MercadoPagoApiError("createCardPayment", status, causes, message);
  }

  it("explica o caso de credencial de produção com cartão de teste", () => {
    const msg = mercadoPagoErrorMessage(erro("Invalid users involved", 400));
    expect(msg).toMatch(/mesma conta/i);
    expect(msg).toMatch(/TEST-/);
  });

  it("aponta a credencial quando a API devolve 401", () => {
    expect(mercadoPagoErrorMessage(erro("unauthorized", 401))).toMatch(
      /MERCADOPAGO_ACCESS_TOKEN/,
    );
  });

  it("trata token de cartão inválido pelo código da causa", () => {
    const msg = mercadoPagoErrorMessage(
      erro("bad_request", 400, [{ code: "3001", description: "Invalid card_token_id" }]),
    );
    expect(msg).toMatch(/validar o cartão/i);
  });

  it("sugere PIX quando o Mercado Pago está instável", () => {
    expect(mercadoPagoErrorMessage(erro("internal_error", 503))).toMatch(/PIX/);
  });

  it("no fallback mostra a descrição do Mercado Pago, nunca 'erro inesperado'", () => {
    const msg = mercadoPagoErrorMessage(
      erro("bad_request", 400, [
        { code: "4037", description: "Invalid transaction_amount" },
      ]),
    );
    expect(msg).toContain("Invalid transaction_amount");
  });
});
