import { describe, it, expect } from "vitest";
import {
  caixasPlasticasDaVenda,
  descontoMaximoDoItemCents,
  mensagemDoErro,
  normalizarBusca,
  somarQuantidade,
  subtrairQuantidade,
  trocoOuFalta,
  trocoPassaDoTeto,
} from "@/app/(app)/vendas/nova/_components/pdv-regras";
import { brutoDoItem, resolvePlasticCrateQty, vendaSchema } from "@/lib/validations/venda";
import { calcularTotaisVenda, paraCentavos } from "@/lib/venda/total";

/**
 * Regras da frente de caixa. Onde a regra espelha o servidor, o teste confere
 * as duas lado a lado: o PDV não importa o schema (zod fora do bundle), então
 * é aqui que uma divergência aparece.
 */

describe("quantidade em 3 casas", () => {
  it("somar o mesmo produto de novo não corta a terceira casa", () => {
    expect(somarQuantidade(2.345, 1.25)).toBe(3.595);
    expect(somarQuantidade(1.255, 1)).toBe(2.255);
    expect(somarQuantidade(0.1, 0.2)).toBe(0.3);
  });

  it("subtrair também (botão − e resumo pós-venda)", () => {
    expect(subtrairQuantidade(10, 2.345)).toBe(7.655);
    expect(subtrairQuantidade(1, 1)).toBe(0);
    expect(subtrairQuantidade(0.5, 1)).toBe(-0.5);
  });
});

describe("troco da caixa 'Cliente pagou com'", () => {
  it("venda mista: compara com a parte em dinheiro, não com o total", () => {
    // R$ 100 = R$ 60 PIX + R$ 40 dinheiro; o cliente entrega R$ 50.
    expect(trocoOuFalta(50, 4_000n)).toEqual({ tipo: "troco", cents: 1_000n });
    expect(trocoOuFalta(40, 4_000n)).toEqual({ tipo: "troco", cents: 0n });
    expect(trocoOuFalta(30, 4_000n)).toEqual({ tipo: "falta", cents: 1_000n });
  });

  it("sem ruído de float", () => {
    expect(trocoOuFalta(0.3, paraCentavos(0.1 + 0.2))).toEqual({ tipo: "troco", cents: 0n });
  });

  it("o teto do troco é o mesmo do servidor", () => {
    const casos: [number, number][] = [
      [10, 510],
      [10, 510.01],
      [40, 540],
      [40, 540.01],
      [800, 1600],
      [800, 1600.01],
    ];
    for (const [emDinheiro, recebido] of casos) {
      const servidorAceita = vendaSchema.safeParse({
        paymentMethod: "DINHEIRO",
        amountReceived: recebido,
        items: [{ productId: "p1", quantity: 1, unitPrice: emDinheiro }],
      }).success;
      expect(trocoPassaDoTeto(paraCentavos(recebido), paraCentavos(emDinheiro))).toBe(
        !servidorAceita,
      );
    }
  });
});

describe("desconto máximo do item", () => {
  it("é o bruto exato truncado no centavo", () => {
    expect(descontoMaximoDoItemCents({ quantity: 2.345, unitPrice: 3 })).toBe(703n);
    expect(descontoMaximoDoItemCents({ quantity: 2, unitPrice: 10 })).toBe(2_000n);
    expect(descontoMaximoDoItemCents({ quantity: 0, unitPrice: 10 })).toBe(0n);
    expect(descontoMaximoDoItemCents({ quantity: 2, unitPrice: 0 })).toBe(0n);
  });

  it("o servidor aceita e a linha nunca fica negativa", () => {
    for (let q = 1; q <= 3_000; q += 7) {
      for (const unitPrice of [0.99, 1.5, 2.5, 3, 7.35, 12.9]) {
        const quantity = q / 1000;
        const max = descontoMaximoDoItemCents({ quantity, unitPrice });
        const discountAmount = Number(max) / 100;
        expect(discountAmount).toBeLessThanOrEqual(brutoDoItem({ quantity, unitPrice }));
        const linha = calcularTotaisVenda({
          items: [{ quantity, unitPrice, discountAmount }],
        }).lineTotalsCents[0]!;
        expect(linha >= 0n).toBe(true);
      }
    }
  });
});

describe("caixas plásticas como o servidor resolve", () => {
  const itens = [
    { recipientType: "PLASTICA", crateQty: 5 },
    { recipientType: "PAPELAO", crateQty: 3 },
    { recipientType: "", crateQty: 0 },
    { recipientType: "PLASTICA", crateQty: 2 },
  ];

  it("concorda com resolvePlasticCrateQty", () => {
    for (const plasticCrateQty of [undefined, 0, 4]) {
      expect(caixasPlasticasDaVenda(plasticCrateQty, itens)).toBe(
        resolvePlasticCrateQty({ plasticCrateQty, items: itens }),
      );
    }
  });

  it("vasilhame plástico na linha, sem checkbox, ainda conta", () => {
    expect(caixasPlasticasDaVenda(0, [{ recipientType: "PLASTICA", crateQty: 5 }])).toBe(5);
  });
});

describe("busca sem acento", () => {
  it("'limao' acha 'Limão'", () => {
    for (const [nome, busca] of [
      ["Limão Tahiti", "limao"],
      ["Mamão Formosa", "MAMAO"],
      ["Pimentão verde", "pimentao"],
      ["Maçã Fuji", "maca"],
    ]) {
      expect(normalizarBusca(nome!).includes(normalizarBusca(busca!))).toBe(true);
    }
  });
});

describe("mensagem de erro do servidor", () => {
  it("falha de schema mostra o motivo, não 'Dados inválidos'", () => {
    expect(
      mensagemDoErro({
        code: "VALIDATION",
        message: "Dados inválidos",
        fields: { customerName: "Informe o cliente para controlar as caixas plásticas" },
      }),
    ).toBe("Informe o cliente para controlar as caixas plásticas");
  });

  it("sem fields, fica a mensagem", () => {
    expect(mensagemDoErro({ code: "VALIDATION", message: "Dados inválidos" })).toBe(
      "Dados inválidos",
    );
    expect(mensagemDoErro({ code: "NOT_FOUND", message: "Produto sumiu", fields: {} })).toBe(
      "Produto sumiu",
    );
  });

  it("parcela de R$ 0,00 chega com o motivo em fields", () => {
    const r = vendaSchema.safeParse({
      paymentMethod: "PIX",
      payments: [
        { method: "PIX", amount: 10 },
        { method: "DINHEIRO", amount: 0 },
      ],
      items: [{ productId: "p1", quantity: 1, unitPrice: 10 }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(
      "Informe o valor desta forma de pagamento",
    );
  });
});
