<<<<<<< HEAD
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  WEBHOOK_MAX_SKEW_SECONDS,
} from "@/lib/payments/mercadopago";

const SECRET = "segredo-de-teste";
const DATA_ID = "1234567890";
const REQUEST_ID = "req-abc";

function assinar(ts: number, secret = SECRET, dataId = DATA_ID, requestId = REQUEST_ID) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

beforeEach(() => {
  vi.stubEnv("MP_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyWebhookSignature", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const nowSeconds = Math.floor(now.getTime() / 1000);

  it("aceita assinatura válida e recente", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
    ).toBe(true);
  });

  it("rejeita assinatura gerada com outro segredo", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds, "segredo-errado"),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
=======
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
>>>>>>> f644e783a382991bbaf54b13f72f4aa83dfb88c6
      }),
    ).toBe(false);
  });

<<<<<<< HEAD
  it("rejeita quando o request-id não confere (manifest diferente)", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds),
        xRequestId: "outro-request-id",
        dataId: DATA_ID,
        now,
      }),
    ).toBe(false);
  });

  it("rejeita quando o data.id não confere", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds),
        xRequestId: REQUEST_ID,
        dataId: "9999",
        now,
      }),
    ).toBe(false);
  });

  it("rejeita replay: assinatura válida mas timestamp antigo", () => {
    const velho = nowSeconds - (WEBHOOK_MAX_SKEW_SECONDS + 60);
    expect(
      verifyWebhookSignature({
        xSignature: assinar(velho),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
    ).toBe(false);
  });

  it("rejeita timestamp muito no futuro", () => {
    const futuro = nowSeconds + (WEBHOOK_MAX_SKEW_SECONDS + 60);
    expect(
      verifyWebhookSignature({
        xSignature: assinar(futuro),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
    ).toBe(false);
  });

  it("rejeita ts não numérico", () => {
    expect(
      verifyWebhookSignature({
        xSignature: "ts=abc,v1=deadbeef",
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
=======
  it("rejeita quando o dataId não bate com o assinado", () => {
    const { xSignature, xRequestId } = sign("12345", "req-1");
    expect(
      verifyWebhookSignature({ xSignature, xRequestId, dataId: "99999" }),
>>>>>>> f644e783a382991bbaf54b13f72f4aa83dfb88c6
    ).toBe(false);
  });

  it("rejeita header ausente ou malformado", () => {
    expect(
<<<<<<< HEAD
      verifyWebhookSignature({ xSignature: null, xRequestId: REQUEST_ID, dataId: DATA_ID, now }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ xSignature: "v1=abc", xRequestId: REQUEST_ID, dataId: DATA_ID, now }),
    ).toBe(false);
  });

  it("sem segredo: bloqueia em produção e libera em desenvolvimento", () => {
    vi.stubEnv("MP_WEBHOOK_SECRET", "");

    vi.stubEnv("NODE_ENV", "production");
    expect(
      verifyWebhookSignature({ xSignature: null, xRequestId: null, dataId: DATA_ID, now }),
    ).toBe(false);

    vi.stubEnv("NODE_ENV", "development");
    expect(
      verifyWebhookSignature({ xSignature: null, xRequestId: null, dataId: DATA_ID, now }),
=======
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
>>>>>>> f644e783a382991bbaf54b13f72f4aa83dfb88c6
    ).toBe(true);
  });
});
