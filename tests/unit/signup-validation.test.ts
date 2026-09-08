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
   * Nada impediria alguém de reacrescentar um campo OBRIGATÓRIO e desfazer a
   * decisão do cadastro mínimo sem nenhum teste reclamar. Este caso é o que
   * segura isso: o formulário pode ganhar campos, desde que sejam opcionais.
   */
  it("o contrato é e-mail, senha, e dois opcionais", () => {
    expect(Object.keys(signupSchema.shape).sort()).toEqual([
      "ceasaCentralCode",
      "email",
      "password",
      "uf",
    ]);
  });

  it("SÓ e-mail e senha são obrigatórios", () => {
    // Estado e central são dois `<select>` que ajudam o módulo de Cotações a já
    // ter o que mostrar no primeiro acesso — mas travar a AQUISIÇÃO por causa
    // deles seria perder cliente por um detalhe que ele conserta em dois toques.
    expect(signupSchema.safeParse({ email: "joao@x.com", password: "senha1234" }).success).toBe(
      true,
    );
  });

  it("aceita estado e central quando informados", () => {
    const out = signupSchema.safeParse({
      ...valido,
      uf: "mg",
      ceasaCentralCode: "CEAMG",
    });
    expect(out.success).toBe(true);
    // A sigla é normalizada: o banco guarda CHAR(2) maiúsculo.
    expect(out.success && out.data.uf).toBe("MG");
  });

  it("recusa estado que não existe", () => {
    // Lista fechada: sem isso, "XX" entraria na coluna e nenhuma tela saberia
    // filtrar central por ele.
    expect(signupSchema.safeParse({ ...valido, uf: "XX" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valido, uf: "Minas" }).success).toBe(false);
  });

  it("estado em branco é 'não informou', não erro", () => {
    // O `<select>` começa com a opção vazia; quem não escolhe manda "".
    expect(signupSchema.safeParse({ ...valido, uf: "" }).success).toBe(true);
  });

  /**
   * Campo opcional NUNCA pode custar a conta.
   *
   * `.optional()` sozinho aceita a chave ausente mas RECUSA a chave presente
   * com `null` — que é o que várias bibliotecas de formulário produzem para
   * campo vazio. O cadastro voltava 422 e a pessoa ia embora por causa de um
   * seletor que ela nem precisava usar.
   */
  it("null nos campos opcionais não derruba o cadastro", () => {
    expect(signupSchema.safeParse({ ...valido, uf: null }).success).toBe(true);
    expect(signupSchema.safeParse({ ...valido, ceasaCentralCode: null }).success).toBe(true);
    expect(
      signupSchema.safeParse({ ...valido, uf: null, ceasaCentralCode: null }).success,
    ).toBe(true);
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
