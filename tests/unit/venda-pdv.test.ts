import { describe, it, expect } from "vitest";
import {
  brutoDoItem,
  totalDaVenda,
  vendaSchema,
  type VendaInput,
} from "@/lib/validations/venda";
import { formaPredominante, resolvePlasticCrateQty } from "@/lib/services/vendas.service";

const item = (patch: Partial<VendaInput["items"][number]> = {}) => ({
  productId: "p1",
  quantity: 2,
  unitPrice: 10,
  ...patch,
});

const venda = (patch: Partial<VendaInput> = {}): unknown => ({
  paymentMethod: "DINHEIRO",
  items: [item()],
  ...patch,
});

describe("total da venda com desconto", () => {
  it("sem desconto, é a soma das linhas", () => {
    expect(totalDaVenda({ items: [item(), item({ quantity: 1 })] })).toBe(30);
  });

  it("desconto por item sai da linha", () => {
    expect(totalDaVenda({ items: [item({ discountAmount: 5 })] })).toBe(15);
  });

  it("desconto da venda sai do total, depois dos descontos de linha", () => {
    expect(
      totalDaVenda({ items: [item({ discountAmount: 5 })], discountAmount: 3 }),
    ).toBe(12);
  });

  it("nunca fica negativo", () => {
    expect(totalDaVenda({ items: [item()], discountAmount: 999 })).toBe(0);
  });

  it("bruto do item ignora desconto", () => {
    expect(brutoDoItem({ quantity: 2.5, unitPrice: 4 })).toBe(10);
  });
});

describe("validação da venda", () => {
  it("venda simples passa", () => {
    expect(vendaSchema.safeParse(venda()).success).toBe(true);
  });

  it("fiado exige cliente", () => {
    expect(vendaSchema.safeParse(venda({ paymentMethod: "FIADO" })).success).toBe(false);
    expect(
      vendaSchema.safeParse(venda({ paymentMethod: "FIADO", customerName: "João" })).success,
    ).toBe(true);
  });

  it("parcela fiada também exige cliente", () => {
    // A parte fiada vira conta a receber, e conta sem nome não é cobrável.
    const misto = venda({
      paymentMethod: "PIX",
      payments: [
        { method: "PIX", amount: 10 },
        { method: "FIADO", amount: 10 },
      ],
    });
    expect(vendaSchema.safeParse(misto).success).toBe(false);
    expect(
      vendaSchema.safeParse({ ...(misto as object), customerName: "João" }).success,
    ).toBe(true);
  });

  it("caixa plástica exige cliente", () => {
    expect(vendaSchema.safeParse(venda({ plasticCrateQty: 3 })).success).toBe(false);
  });

  it("as formas de pagamento têm de fechar com o total", () => {
    const errado = venda({
      payments: [
        { method: "PIX", amount: 5 },
        { method: "DINHEIRO", amount: 5 },
      ],
    });
    const r = vendaSchema.safeParse(errado);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["payments"]);

    const certo = venda({
      payments: [
        { method: "PIX", amount: 12 },
        { method: "DINHEIRO", amount: 8 },
      ],
    });
    expect(vendaSchema.safeParse(certo).success).toBe(true);
  });

  it("a conferência das parcelas considera o desconto", () => {
    // Total = 20 − 5 = 15. Somar 20 nas parcelas seria cobrar o valor sem desconto.
    const comDesconto = venda({
      discountAmount: 5,
      payments: [{ method: "PIX", amount: 15 }],
    });
    expect(vendaSchema.safeParse(comDesconto).success).toBe(true);
    expect(
      vendaSchema.safeParse(venda({ discountAmount: 5, payments: [{ method: "PIX", amount: 20 }] }))
        .success,
    ).toBe(false);
  });

  it("tolera diferença de centavo na divisão", () => {
    const terco = venda({
      items: [item({ quantity: 1, unitPrice: 10 })],
      payments: [
        { method: "PIX", amount: 3.33 },
        { method: "DINHEIRO", amount: 3.33 },
        { method: "CARTAO", amount: 3.34 },
      ],
    });
    expect(vendaSchema.safeParse(terco).success).toBe(true);
  });

  it("desconto do item não passa do valor do item", () => {
    expect(vendaSchema.safeParse(venda({ items: [item({ discountAmount: 999 })] })).success).toBe(
      false,
    );
  });

  it("desconto da venda não passa do total", () => {
    const r = vendaSchema.safeParse(venda({ discountAmount: 999 }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["discountAmount"]);
  });

  it("preço zero é barrado até haver confirmação explícita", () => {
    // Passava batido e a venda entrava zerada, distorcendo faturamento e lucro.
    expect(vendaSchema.safeParse(venda({ items: [item({ unitPrice: 0 })] })).success).toBe(false);
    expect(
      vendaSchema.safeParse(
        venda({ items: [item({ unitPrice: 0 })], permitirPrecoZero: true }),
      ).success,
    ).toBe(true);
  });

  it("no máximo 4 formas de pagamento", () => {
    const cinco = venda({
      items: [item({ quantity: 1, unitPrice: 5 })],
      payments: [
        { method: "PIX", amount: 1 },
        { method: "DINHEIRO", amount: 1 },
        { method: "CARTAO", amount: 1 },
        { method: "FIADO", amount: 1 },
        { method: "PIX", amount: 1 },
      ],
      customerName: "João",
    });
    expect(vendaSchema.safeParse(cinco).success).toBe(false);
  });

  it("quantidade decimal é aceita (venda por quilo)", () => {
    expect(
      vendaSchema.safeParse(venda({ items: [item({ quantity: 2.35, unitPrice: 8 })] })).success,
    ).toBe(true);
  });
});

describe("formaPredominante", () => {
  it("sem parcelas, usa a forma informada", () => {
    expect(formaPredominante([], "PIX")).toBe("PIX");
  });

  it("qualquer parcela fiada torna a venda fiada", () => {
    // Existe conta a receber; a venda tem de aparecer como fiado nas listas.
    expect(
      formaPredominante(
        [
          { method: "PIX", amount: 90 },
          { method: "FIADO", amount: 10 },
        ],
        "PIX",
      ),
    ).toBe("FIADO");
  });

  it("sem fiado, vence a de maior valor", () => {
    expect(
      formaPredominante(
        [
          { method: "PIX", amount: 30 },
          { method: "DINHEIRO", amount: 70 },
        ],
        "PIX",
      ),
    ).toBe("DINHEIRO");
  });
});

describe("resolvePlasticCrateQty", () => {
  it("usa o valor informado na venda", () => {
    expect(resolvePlasticCrateQty({ plasticCrateQty: 7, items: [] } as unknown as VendaInput)).toBe(
      7,
    );
  });

  it("sem valor informado, soma só os itens em caixa PLÁSTICA", () => {
    const input = {
      items: [
        { productId: "a", quantity: 1, unitPrice: 1, recipientType: "PLASTICA", crateQty: 4 },
        { productId: "b", quantity: 1, unitPrice: 1, recipientType: "PAPELAO", crateQty: 9 },
        { productId: "c", quantity: 1, unitPrice: 1, recipientType: "PLASTICA", crateQty: 2 },
      ],
    } as unknown as VendaInput;
    expect(resolvePlasticCrateQty(input)).toBe(6);
  });
});
