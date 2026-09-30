import { describe, expect, it } from "vitest";
import { cnpjValido, normalizarCnpj } from "@/lib/cnpj";
import { cnpjSchema, empresaSchema } from "@/lib/validations/config";

/**
 * O CNPJ era gravado como digitado, sem conferir nada: o mesmo número entrava
 * duas vezes em formatos diferentes, e um dígito trocado só aparecia quando o
 * Mercado Pago recusava o PIX da mensalidade.
 */
describe("cnpjValido", () => {
  it.each(["11.222.333/0001-81", "11222333000181", "11.444.777/0001-61", "45.997.418/0001-53"])(
    "aceita %s",
    (c) => expect(cnpjValido(c)).toBe(true),
  );

  it.each([
    "11.222.333/0001-82", // 2º DV errado
    "11.222.333/0001-91", // 1º DV errado
    "1122233300018", // 13 dígitos
    "112223330001811", // 15 dígitos
    "00000000000000",
    "11111111111111",
    "",
    "abc",
  ])("recusa %j", (c) => expect(cnpjValido(c)).toBe(false));

  it("normaliza para só dígitos", () => {
    expect(normalizarCnpj(" 11.222.333/0001-81 ")).toBe("11222333000181");
  });
});

describe("cnpjSchema", () => {
  it("grava só os dígitos, venha com máscara ou prefixo colado", () => {
    expect(cnpjSchema.parse("11.222.333/0001-81")).toBe("11222333000181");
    expect(cnpjSchema.parse("CNPJ: 11.222.333/0001-81")).toBe("11222333000181");
    expect(cnpjSchema.parse("11222333000181")).toBe("11222333000181");
  });

  it("vazio continua virando null (a coluna é @unique)", () => {
    expect(cnpjSchema.parse("")).toBeNull();
    expect(cnpjSchema.parse("   ")).toBeNull();
    expect(cnpjSchema.parse(null)).toBeNull();
    expect(cnpjSchema.parse(undefined)).toBeUndefined();
  });

  it("recusa DV inválido e texto sem número, com mensagem", () => {
    const r = empresaSchema.safeParse({ tradeName: "Box", cnpj: "11.222.333/0001-82" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/CNPJ inválido/);
    expect(cnpjSchema.safeParse("abc").success).toBe(false);
  });
});
