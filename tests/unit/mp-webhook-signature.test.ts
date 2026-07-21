import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "@/lib/payments/mercadopago";

const SECRET = "segredo-de-teste-webhook";
const originalSecret = process.env.MP_WEBHOOK_SECRET;

/** Monta o header x-signature exatamente como o Mercado Pago envia. */
function sign(dataId: string, requestId: string, ts = "1700000000") {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return { xSignature: `ts=${ts},v1=${v1}`, xRequestId: requestId };
}

beforeEach(() => {
  process.env.MP_WEBHOOK_SECRET = SECRET;
});

afterAll(() => {
  process.env.MP_WEBHOOK_SECRET = originalSecret;
});

describe("verifyWebhookSignature — assinatura HMAC do webhook Mercado Pago", () => {
  it("aceita uma assinatura válida", () => {
    const { xSignature, xRequestId } = sign("12345", "req-1");
    expect(
      verifyWebhookSignature({ xSignature, xRequestId, dataId: "12345" }),
    ).toBe(true);
  });

  it("rejeita assinatura adulterada", () => {
    const { xRequestId } = sign("12345", "req-1");
    expect(
      verifyWebhookSignature({
        xSignature: "ts=1700000000,v1=deadbeef",
        xRequestId,
        dataId: "12345",
      }),
    ).toBe(false);
  });

  it("rejeita quando o dataId não bate com o assinado", () => {
    const { xSignature, xRequestId } = sign("12345", "req-1");
    expect(
      verifyWebhookSignature({ xSignature, xRequestId, dataId: "99999" }),
    ).toBe(false);
  });

  it("rejeita header ausente ou malformado", () => {
    expect(
      verifyWebhookSignature({ xSignature: null, xRequestId: "r", dataId: "1" }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ xSignature: "lixo", xRequestId: "r", dataId: "1" }),
    ).toBe(false);
  });

  it("sem segredo configurado: permite fora de produção (dev), nunca em produção", () => {
    delete process.env.MP_WEBHOOK_SECRET;
    // Em teste/dev (NODE_ENV != production) → true, com aviso no log.
    expect(
      verifyWebhookSignature({ xSignature: null, xRequestId: null, dataId: "1" }),
    ).toBe(true);
  });
});
