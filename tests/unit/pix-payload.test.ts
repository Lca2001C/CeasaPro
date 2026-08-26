import { describe, it, expect } from "vitest";
import { isoComOffsetTz } from "@/lib/tz";
import { splitNome } from "@/lib/payments/mercadopago";

/**
 * O Mercado Pago recusa `date_of_expiration` terminado em `Z` na cobrança PIX:
 * o campo precisa do deslocamento explícito. O 400 daí voltava para o cliente
 * como "não foi possível gerar o código".
 */
describe("isoComOffsetTz", () => {
  it("usa o deslocamento do fuso, não o Z de toISOString", () => {
    const d = new Date("2026-08-28T17:30:00.000Z"); // 14:30 no Brasil
    const iso = isoComOffsetTz(d);
    expect(iso).toBe("2026-08-28T14:30:00.000-03:00");
    expect(iso.endsWith("Z")).toBe(false);
    // O jeito antigo mandava a hora UTC com Z.
    expect(d.toISOString()).toBe("2026-08-28T17:30:00.000Z");
  });

  it("preserva os milissegundos", () => {
    expect(isoComOffsetTz(new Date("2026-01-05T03:00:00.250Z"))).toBe(
      "2026-01-05T00:00:00.250-03:00",
    );
  });

  it("atravessa a virada do dia sem perder a data local", () => {
    // 01/01/2027 01:00 UTC = 31/12/2026 22:00 no Brasil.
    expect(isoComOffsetTz(new Date("2027-01-01T01:00:00.000Z"))).toBe(
      "2026-12-31T22:00:00.000-03:00",
    );
  });

  it("é reversível: o instante volta igual", () => {
    const d = new Date("2026-08-28T17:30:00.000Z");
    expect(new Date(isoComOffsetTz(d)).getTime()).toBe(d.getTime());
  });
});

describe("splitNome (pagador do PIX)", () => {
  it("separa nome e sobrenome", () => {
    expect(splitNome("Maria Silva")).toEqual({ firstName: "Maria", lastName: "Silva" });
  });

  it("mantém nomes compostos no sobrenome", () => {
    expect(splitNome("Maria da Silva Souza")).toEqual({
      firstName: "Maria",
      lastName: "da Silva Souza",
    });
  });

  it("com um nome só, não inventa sobrenome", () => {
    expect(splitNome("Maria")).toEqual({ firstName: "Maria" });
  });

  it("tolera espaços extras, vazio e ausência", () => {
    expect(splitNome("  Ana   Paula  ")).toEqual({ firstName: "Ana", lastName: "Paula" });
    expect(splitNome("")).toEqual({});
    expect(splitNome(null)).toEqual({});
    expect(splitNome(undefined)).toEqual({});
  });
});
