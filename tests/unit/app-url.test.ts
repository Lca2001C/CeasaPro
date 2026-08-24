import { describe, expect, it, afterEach } from "vitest";
import { appBaseUrl, absoluteUrl, hasConfiguredAppUrl } from "@/lib/app-url";

const KEYS = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "RENDER_EXTERNAL_URL",
  "RENDER_EXTERNAL_HOSTNAME",
] as const;

const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("appBaseUrl", () => {
  it("usa APP_URL quando definida", () => {
    setEnv({ APP_URL: "https://app.ceasapro.com.br", NEXT_PUBLIC_APP_URL: "https://outro.com" });
    expect(appBaseUrl()).toBe("https://app.ceasapro.com.br");
  });

  it("remove barras finais", () => {
    setEnv({ APP_URL: "https://app.ceasapro.com.br///" });
    expect(absoluteUrl("/recuperar-senha/abc")).toBe(
      "https://app.ceasapro.com.br/recuperar-senha/abc",
    );
  });

  it("cai em RENDER_EXTERNAL_URL quando APP_URL nao foi preenchida no Blueprint", () => {
    setEnv({ RENDER_EXTERNAL_URL: "https://ceasapro.onrender.com" });
    expect(appBaseUrl()).toBe("https://ceasapro.onrender.com");
    expect(hasConfiguredAppUrl()).toBe(true);
  });

  it("completa o esquema quando so ha o hostname do Render", () => {
    setEnv({ RENDER_EXTERNAL_HOSTNAME: "ceasapro.onrender.com" });
    expect(appBaseUrl()).toBe("https://ceasapro.onrender.com");
  });

  it("ignora valor vazio e continua para o proximo candidato", () => {
    setEnv({ APP_URL: "   ", RENDER_EXTERNAL_URL: "https://ceasapro.onrender.com" });
    expect(appBaseUrl()).toBe("https://ceasapro.onrender.com");
  });

  it("sem nenhuma variavel, avisa que a URL nao esta configurada", () => {
    setEnv({});
    expect(appBaseUrl()).toBe("http://localhost:3000");
    expect(hasConfiguredAppUrl()).toBe(false);
  });

  it("localhost explicito em dev conta como configurado (nao e ausencia de config)", () => {
    setEnv({ APP_URL: "http://localhost:3000" });
    expect(hasConfiguredAppUrl()).toBe(true);
  });

  it("aceita caminho sem barra inicial", () => {
    setEnv({ APP_URL: "https://app.ceasapro.com.br" });
    expect(absoluteUrl("login")).toBe("https://app.ceasapro.com.br/login");
  });
});
