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
  email: "Joao@Exemplo.COM ",
  password: "senha1234",
};

describe("signupSchema", () => {
  /**
   * O contrato do cadastro é afirmado, não subentendido.
   *
   * Antes este arquivo tinha cinco casos validando nome do negócio, telefone e
   * tipo de estabelecimento. Apagá-los sem pôr nada no lugar deixaria um vazio:
   * nada impediria alguém de reacrescentar um campo obrigatório e desfazer a
   * decisão do cadastro mínimo sem nenhum teste reclamar. Este caso é o que
   * segura isso.
   */
  it("pede E-MAIL E SENHA, e mais nada", () => {
    expect(Object.keys(signupSchema.shape).sort()).toEqual(["email", "password"]);
  });

  it("normaliza e-mail (trim + minúsculas)", () => {
    const out = signupSchema.parse(valido);
    expect(out.email).toBe("joao@exemplo.com");
  });

  /**
   * PWA em cache é o caso real: o app instalado guarda a versão anterior da tela
   * e continua mandando `tradeName`/`phone` depois do deploy. O Zod descarta os
   * campos desconhecidos, e o cadastro tem de SEGUIR — recusar deixaria quem não
   * atualizou sem conseguir criar conta, sem entender por quê.
   *
   * Hoje isso é consequência acidental do `strip` padrão do Zod. Aqui vira
   * comportamento declarado.
   */
  it("cliente antigo mandando campos a mais ainda consegue se cadastrar", () => {
    const out = signupSchema.safeParse({
      ...valido,
      tradeName: "Hortifrúti Silva",
      phone: "(31) 99999-9999",
      establishmentType: "Box 42",
    });
    expect(out.success).toBe(true);
    // E os campos extras não atravessam: nada deles chega ao serviço.
    expect(out.success && Object.keys(out.data).sort()).toEqual(["email", "password"]);
  });

  it("aplica a política de senha do projeto", () => {
    expect(signupSchema.safeParse({ ...valido, password: "curta1" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valido, password: "semnumeros" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valido, password: "12345678" }).success).toBe(false);
  });

  it("limita o tamanho da senha (entrada não autenticada)", () => {
    expect(signupSchema.safeParse({ ...valido, password: "a1".repeat(200) }).success).toBe(false);
  });

  it("recusa e-mail inválido", () => {
    expect(signupSchema.safeParse({ ...valido, email: "nao-e-email" }).success).toBe(false);
  });

  it("exige os dois campos — nenhum deles é opcional", () => {
    expect(signupSchema.safeParse({ email: "joao@exemplo.com" }).success).toBe(false);
    expect(signupSchema.safeParse({ password: "senha1234" }).success).toBe(false);
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
