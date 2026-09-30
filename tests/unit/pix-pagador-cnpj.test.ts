import { describe, it, expect } from "vitest";
import { identificacaoDoPagador } from "@/lib/services/billing.service";

/**
 * Documento do pagador no PIX da mensalidade.
 *
 * Conferir só o tamanho mandava ao Mercado Pago o CNPJ com dígito trocado que a
 * base antiga tem (gravado antes de o cadastro validar o DV), e o PIX era
 * recusado sem dizer por quê. Sem documento, o PIX sai normalmente.
 */
describe("identificacaoDoPagador", () => {
  it("CNPJ válido, com ou sem máscara, vai só com os dígitos", () => {
    expect(identificacaoDoPagador("11.222.333/0001-81")).toEqual({
      type: "CNPJ",
      number: "11222333000181",
    });
    expect(identificacaoDoPagador("11222333000181")?.number).toBe("11222333000181");
  });

  it("DV errado, repetido, curto ou vazio: sem documento", () => {
    expect(identificacaoDoPagador("11.222.333/0001-82")).toBeNull();
    expect(identificacaoDoPagador("11111111111111")).toBeNull();
    expect(identificacaoDoPagador("1122233300018")).toBeNull();
    expect(identificacaoDoPagador(null)).toBeNull();
  });
});
