import { describe, it, expect } from "vitest";
import { signupSchema } from "@/lib/validations/auth";
import {
  createVerifyToken,
  hashVerifyToken,
  looksLikeVerifyToken,
  verifyTokenExpiry,
  VERIFY_TOKEN_TTL_HOURS,
} from "@/lib/auth/verify-token";

const valido = {
  tradeName: "Hortifrúti Silva",
  email: "Joao@Exemplo.COM ",
  phone: "(31) 99999-9999",
  establishmentType: "Box 42",
  password: "senha1234",
};

describe("signupSchema", () => {
  it("normaliza e-mail (trim + minúsculas)", () => {
    const out = signupSchema.parse(valido);
    expect(out.email).toBe("joao@exemplo.com");
  });

  it("aceita telefone com máscara e guarda só dígitos", () => {
    // A máscara que o usuário digita não pode ser motivo de recusa.
    expect(signupSchema.parse(valido).phone).toBe("31999999999");
    expect(signupSchema.parse({ ...valido, phone: "31 3333-3333" }).phone).toBe("3133333333");
  });

  it("recusa telefone sem DDD", () => {
    expect(signupSchema.safeParse({ ...valido, phone: "99999999" }).success).toBe(false);
  });

  it("recusa telefone longo demais", () => {
    expect(signupSchema.safeParse({ ...valido, phone: "319999999999" }).success).toBe(false);
  });

  it("tipo de estabelecimento é opcional", () => {
    const semTipo: Partial<typeof valido> = { ...valido };
    delete semTipo.establishmentType;
    expect(signupSchema.safeParse(semTipo).success).toBe(true);
  });

  it("aplica a política de senha do projeto", () => {
    expect(signupSchema.safeParse({ ...valido, password: "curta1" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valido, password: "semnumeros" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valido, password: "12345678" }).success).toBe(false);
  });

  it("limita o tamanho da senha (entrada não autenticada)", () => {
    expect(signupSchema.safeParse({ ...valido, password: "a1".repeat(200) }).success).toBe(false);
  });

  it("recusa nome de negócio vazio ou curto", () => {
    expect(signupSchema.safeParse({ ...valido, tradeName: " " }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valido, tradeName: "A" }).success).toBe(false);
  });

  it("recusa e-mail inválido", () => {
    expect(signupSchema.safeParse({ ...valido, email: "nao-e-email" }).success).toBe(false);
  });
});

describe("token de confirmação de e-mail", () => {
  it("não guarda o token cru — só o SHA-256", () => {
    const t = createVerifyToken();
    expect(t.tokenHash).not.toBe(t.raw);
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.tokenHash).toBe(hashVerifyToken(t.raw));
  });

  it("gera tokens distintos a cada chamada", () => {
    const a = createVerifyToken();
    const b = createVerifyToken();
    expect(a.raw).not.toBe(b.raw);
  });

  it("tem entropia suficiente para não ser adivinhado", () => {
    // 32 bytes em base64url ≈ 43 caracteres.
    expect(createVerifyToken().raw.length).toBeGreaterThanOrEqual(43);
  });

  it("vale por VERIFY_TOKEN_TTL_HOURS", () => {
    const agora = new Date("2026-08-31T12:00:00Z");
    const esperado = agora.getTime() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    expect(verifyTokenExpiry(agora).getTime()).toBe(esperado);
  });

  it("filtra lixo antes de consultar o banco", () => {
    expect(looksLikeVerifyToken(createVerifyToken().raw)).toBe(true);
    expect(looksLikeVerifyToken("curto")).toBe(false);
    expect(looksLikeVerifyToken("com/caracteres+invalidos=")).toBe(false);
    expect(looksLikeVerifyToken("")).toBe(false);
    expect(looksLikeVerifyToken(null)).toBe(false);
    expect(looksLikeVerifyToken(undefined)).toBe(false);
  });
});
