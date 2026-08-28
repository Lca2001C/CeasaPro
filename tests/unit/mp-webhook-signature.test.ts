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
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyWebhookSignature", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const nowSeconds = Math.floor(now.getTime() / 1000);

  it("aceita assinatura válida e recente, devolvendo o id autenticado", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
    ).toBe(DATA_ID);
  });

  it("rejeita assinatura gerada com outro segredo", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds, "segredo-errado"),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
    ).toBeNull();
  });

  it("rejeita quando o request-id não confere (manifest diferente)", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds),
        xRequestId: "outro-request-id",
        dataId: DATA_ID,
        now,
      }),
    ).toBeNull();
  });

  it("aceita quando o MP OMITE o request-id do manifesto", () => {
    // Regra da especificação: segmento ausente sai do manifesto. O código
    // montava `request-id:;` e o HMAC nunca batia — 401 com assinatura boa.
    const manifest = `id:${DATA_ID};ts:${nowSeconds};`;
    const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${nowSeconds},v1=${v1}`,
        xRequestId: REQUEST_ID, // veio no cabeçalho, mas não entrou no manifesto
        dataId: DATA_ID,
        now,
      }),
    ).toBe(DATA_ID);
  });

  it("aceita notificação SEM o cabeçalho x-request-id", () => {
    const manifest = `id:${DATA_ID};ts:${nowSeconds};`;
    const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${nowSeconds},v1=${v1}`,
        xRequestId: null,
        dataId: DATA_ID,
        now,
      }),
    ).toBe(DATA_ID);
  });

  it("aceita ts em MILISSEGUNDOS (o MP já enviou nos dois formatos)", () => {
    // Comparar 13 dígitos com 10 dava diferença astronômica e a janela
    // anti-replay recusava tudo.
    const tsMs = nowSeconds * 1000;
    const manifest = `id:${DATA_ID};request-id:${REQUEST_ID};ts:${tsMs};`;
    const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${tsMs},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
    ).toBe(DATA_ID);
  });

  it("devolve o id da QUERY — o do corpo NÃO pode ser o processado", () => {
    // O ponto do contrato: com dois candidatos, quem chama tem de processar
    // exatamente o que fechou o HMAC. Devolver booleano deixava o chamador
    // livre para usar o id do corpo, que não foi autenticado — apresentar
    // assinatura válida para um pagamento e processar outro.
    const manifest = `id:${DATA_ID};request-id:${REQUEST_ID};ts:${nowSeconds};`;
    const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
    const idAutenticado = verifyWebhookSignature({
      xSignature: `ts=${nowSeconds},v1=${v1}`,
      xRequestId: REQUEST_ID,
      dataId: DATA_ID,
      dataIdAlt: "outro-id-do-corpo",
      now,
    });
    expect(idAutenticado).toBe(DATA_ID);
    expect(idAutenticado).not.toBe("outro-id-do-corpo");
  });

  it("devolve o id do CORPO quando é ele que está assinado", () => {
    // Caminho simétrico: o MP às vezes assina o id que veio no corpo. Aceitar o
    // candidato alternativo é legítimo — o que não pode é processar um id que
    // nenhuma assinatura cobriu.
    const idCorpo = "9876543210";
    const manifest = `id:${idCorpo};request-id:${REQUEST_ID};ts:${nowSeconds};`;
    const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${nowSeconds},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: "id-da-query-nao-assinado",
        dataIdAlt: idCorpo,
        now,
      }),
    ).toBe(idCorpo);
  });

  it("testar variantes NÃO afrouxa a verificação: segredo errado continua recusado", () => {
    const manifest = `id:${DATA_ID};ts:${nowSeconds};`;
    const v1 = createHmac("sha256", "segredo-errado").update(manifest).digest("hex");
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${nowSeconds},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        dataIdAlt: "9999",
        now,
      }),
    ).toBeNull();
  });

  it("não lança quando o v1 tem tamanho diferente do hash", () => {
    // `timingSafeEqual` lança se os buffers têm tamanhos diferentes.
    expect(() =>
      verifyWebhookSignature({
        xSignature: `ts=${nowSeconds},v1=curto`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
    ).not.toThrow();
  });

  it("aceita data.id alfanumérico em MAIÚSCULAS (o MP assina em minúsculas)", () => {
    // O Mercado Pago monta o manifest com o data.id minúsculo. Sem normalizar,
    // tópicos de id alfanumérico voltariam 401 e seriam reenviados sem parar.
    // O id devolvido vem normalizado, na mesma forma que foi assinada.
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds, SECRET, "abc123def"),
        xRequestId: REQUEST_ID,
        dataId: "ABC123DEF",
        now,
      }),
    ).toBe("abc123def");
  });

  it("rejeita quando o data.id não confere", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar(nowSeconds),
        xRequestId: REQUEST_ID,
        dataId: "9999",
        now,
      }),
    ).toBeNull();
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
    ).toBeNull();
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
    ).toBeNull();
  });

  it("rejeita ts não numérico", () => {
    expect(
      verifyWebhookSignature({
        xSignature: "ts=abc,v1=deadbeef",
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        now,
      }),
    ).toBeNull();
  });

  it("rejeita header ausente ou malformado", () => {
    expect(
      verifyWebhookSignature({ xSignature: null, xRequestId: REQUEST_ID, dataId: DATA_ID, now }),
    ).toBeNull();
    expect(
      verifyWebhookSignature({ xSignature: "v1=abc", xRequestId: REQUEST_ID, dataId: DATA_ID, now }),
    ).toBeNull();
  });

  it("sem segredo: bloqueia em produção e libera em desenvolvimento", () => {
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "");

    vi.stubEnv("NODE_ENV", "production");
    expect(
      verifyWebhookSignature({ xSignature: null, xRequestId: null, dataId: DATA_ID, now }),
    ).toBeNull();

    vi.stubEnv("NODE_ENV", "development");
    expect(
      verifyWebhookSignature({ xSignature: null, xRequestId: null, dataId: DATA_ID, now }),
    ).toBe(DATA_ID);
  });
});
