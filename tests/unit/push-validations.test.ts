import { describe, it, expect } from "vitest";
import { pushSubscribeSchema, pushUnsubscribeSchema } from "@/lib/validations/push";

/**
 * O `endpoint` é o único campo desta entrada que o servidor depois USA como
 * endereço de saída: o cron faz uma requisição para ele. Por isso a validação
 * aqui não é formalidade — é o que impede transformar o cron em cliente de um
 * endereço arbitrário (SSRF), e o que impede lixo virar linha permanente na
 * tabela, tentada todo dia.
 */

const valido = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "BEl62iUYgUivxIkv69yViEuiBIa", auth: "8eDyX_uCN0XRhSbY5hs7Hg" },
};

describe("pushSubscribeSchema", () => {
  it("aceita uma inscrição real de navegador", () => {
    const r = pushSubscribeSchema.safeParse(valido);
    expect(r.success).toBe(true);
  });

  it("aceita os endpoints dos outros serviços de push", () => {
    for (const endpoint of [
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
      "https://wns2-par02p.notify.windows.com/w/?token=Ag",
      "https://web.push.apple.com/QOoW1Lq",
    ]) {
      expect(pushSubscribeSchema.safeParse({ ...valido, endpoint }).success).toBe(true);
    }
  });

  it("recusa endpoint http — nenhum serviço de push usa, e abriria saída para endereço arbitrário", () => {
    const r = pushSubscribeSchema.safeParse({ ...valido, endpoint: "http://interno.local/push" });
    expect(r.success).toBe(false);
  });

  it("recusa esquemas que não são http(s)", () => {
    for (const endpoint of ["file:///etc/passwd", "gopher://a/b", "javascript:alert(1)"]) {
      expect(pushSubscribeSchema.safeParse({ ...valido, endpoint }).success).toBe(false);
    }
  });

  it("recusa endpoint que não é URL", () => {
    expect(pushSubscribeSchema.safeParse({ ...valido, endpoint: "nao-e-url" }).success).toBe(false);
  });

  it("recusa endpoint gigante: a coluna é única e a linha seria permanente", () => {
    const gigante = `https://fcm.googleapis.com/fcm/send/${"a".repeat(2100)}`;
    expect(pushSubscribeSchema.safeParse({ ...valido, endpoint: gigante }).success).toBe(false);
  });

  it("exige as duas chaves de criptografia", () => {
    expect(pushSubscribeSchema.safeParse({ endpoint: valido.endpoint }).success).toBe(false);
    expect(
      pushSubscribeSchema.safeParse({ ...valido, keys: { p256dh: "x" } }).success,
    ).toBe(false);
    // Vazia não serve: sem a chave o payload não pode ser criptografado.
    expect(
      pushSubscribeSchema.safeParse({ ...valido, keys: { p256dh: "", auth: "y" } }).success,
    ).toBe(false);
  });

  it("recusa chaves acima do tamanho de uma chave real", () => {
    expect(
      pushSubscribeSchema.safeParse({
        ...valido,
        keys: { p256dh: "a".repeat(300), auth: "b" },
      }).success,
    ).toBe(false);
  });
});

describe("pushUnsubscribeSchema", () => {
  it("aceita só o endpoint", () => {
    expect(pushUnsubscribeSchema.safeParse({ endpoint: valido.endpoint }).success).toBe(true);
  });

  it("recusa corpo sem endpoint", () => {
    expect(pushUnsubscribeSchema.safeParse({}).success).toBe(false);
  });
});
