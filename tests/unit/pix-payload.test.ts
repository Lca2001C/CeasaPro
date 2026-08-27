import { describe, it, expect } from "vitest";
import { isoComOffsetTz } from "@/lib/tz";
import { additionalInfo, splitNome } from "@/lib/payments/mercadopago";

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

/**
 * `additional_info` alimenta a prevenção a fraude do Mercado Pago. O painel
 * dele pede `items.description` explicitamente: cobrança sem contexto do que
 * está sendo vendido tem mais chance de recusa preventiva, e o campo também
 * conta na nota de "qualidade da integração".
 */
describe("additionalInfo (índice de aprovação do Mercado Pago)", () => {
  const base = {
    amount: 149.9,
    description: "CeasaPro - mensalidade 2026-08 - Hortifruti São João",
    externalReference: "sub:abc:2026-08:pix",
    detalhe: "Mensalidade do CeasaPro — serviço digital por assinatura.",
  };

  it("descreve o item, com categoria e preço", () => {
    const info = additionalInfo({ ...base, payerName: "Maria da Silva" });
    const item = info.items[0];

    expect(item.description).toBe(base.detalhe);
    expect(item.title).toBe(base.description);
    expect(item.category_id).toBe("services");
    expect(item.quantity).toBe(1);
    expect(item.unit_price).toBe(149.9);
    // O id do item amarra a cobrança à referência externa, que é como o
    // Mercado Pago correlaciona o pagamento com a nossa assinatura.
    expect(item.id).toBe(base.externalReference);
  });

  /**
   * `/v1/payments` recusa o pagamento INTEIRO quando o payload traz um campo
   * que ele não conhece — responde "The name of the parameters is wrong" e
   * nenhuma cobrança é criada. Foi o que aconteceu com `currency_id`, que
   * existe em item de *Preferência* (Checkout Pro) mas não aqui.
   *
   * O tipo `Items` do SDK é compartilhado entre Preferências e Pagamentos e
   * aceita os dois conjuntos, então o TypeScript não pega isto: a lista abaixo
   * é a única trava. Só acrescente um campo depois de conferir na referência
   * de `POST /v1/payments` que ele vale para `additional_info.items`.
   */
  it("não manda nenhum campo fora do que /v1/payments aceita no item", () => {
    const PERMITIDOS = [
      "id",
      "title",
      "description",
      "picture_url",
      "category_id",
      "quantity",
      "unit_price",
    ];
    const info = additionalInfo({ ...base, payerName: "Maria da Silva" });
    const enviados = Object.keys(info.items[0]);
    expect(enviados.filter((k) => !PERMITIDOS.includes(k))).toEqual([]);
    // Explícito porque foi ESTE campo que derrubou PIX e cartão em produção.
    expect(enviados).not.toContain("currency_id");
  });

  /** Mesma armadilha no pagador: `additional_info.payer` não aceita `email`. */
  it("não manda e-mail no pagador do additional_info", () => {
    const info = additionalInfo({ ...base, payerName: "Maria da Silva" });
    expect(Object.keys(info.payer ?? {})).toEqual(
      expect.not.arrayContaining(["email", "identification"]),
    );
  });

  it("envia nome e sobrenome do pagador separados", () => {
    const info = additionalInfo({ ...base, payerName: "Maria da Silva Souza" });
    expect(info.payer).toEqual({ first_name: "Maria", last_name: "da Silva Souza" });
  });

  it("sem nome, omite o bloco do pagador em vez de mandar vazio", () => {
    // Campo vazio conta como dado ruim na análise — pior que ausente.
    expect(additionalInfo({ ...base, payerName: null }).payer).toBeUndefined();
    expect(additionalInfo({ ...base, payerName: "  " }).payer).toBeUndefined();
  });

  it("com um nome só, manda apenas o primeiro nome", () => {
    expect(additionalInfo({ ...base, payerName: "Maria" }).payer).toEqual({
      first_name: "Maria",
    });
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
