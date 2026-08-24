import { describe, expect, it } from "vitest";
import {
  RESET_TOKEN_TTL_MINUTES,
  createResetToken,
  hashResetToken,
  looksLikeResetToken,
  maskEmail,
  resetTokenExpiry,
} from "@/lib/auth/reset-token";

describe("token de redefinicao de senha", () => {
  it("gera token seguro para URL e nunca devolve o hash como token", () => {
    const { raw, tokenHash } = createResetToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes em base64url
    expect(raw).not.toBe(tokenHash);
    expect(encodeURIComponent(raw)).toBe(raw); // vai no path sem escapar
  });

  it("nao repete tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createResetToken().raw));
    expect(tokens.size).toBe(50);
  });

  it("o hash gravado e SHA-256 deterministico do token cru", () => {
    const { raw, tokenHash } = createResetToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(raw)).toBe(tokenHash);
    expect(hashResetToken(`${raw}x`)).not.toBe(tokenHash);
  });

  it("expira em 1 hora a partir de agora", () => {
    const now = new Date("2026-08-24T10:00:00.000Z");
    expect(resetTokenExpiry(now).toISOString()).toBe("2026-08-24T11:00:00.000Z");
    expect(RESET_TOKEN_TTL_MINUTES).toBe(60);
    expect(createResetToken(now).expiresAt.getTime()).toBe(resetTokenExpiry(now).getTime());
  });

  it("descarta formatos invalidos antes de consultar o banco", () => {
    expect(looksLikeResetToken(createResetToken().raw)).toBe(true);
    expect(looksLikeResetToken("curto")).toBe(false);
    expect(looksLikeResetToken("a".repeat(200))).toBe(false);
    expect(looksLikeResetToken("token/com/barra/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(looksLikeResetToken("' OR 1=1 --aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(looksLikeResetToken(undefined)).toBe(false);
    expect(looksLikeResetToken(null)).toBe(false);
  });

  it("mascara o e-mail preservando o dominio", () => {
    expect(maskEmail("dono@ceasapro.com.br")).toBe("do**@ceasapro.com.br");
    expect(maskEmail("a@ceasapro.com.br")).toBe("a***@ceasapro.com.br");
    expect(maskEmail("nome.muito.grande@ceasapro.com.br")).toBe("no******@ceasapro.com.br");
    expect(maskEmail("sem-arroba")).toBe("***");
  });
});
