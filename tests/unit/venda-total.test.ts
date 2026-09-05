import { describe, it, expect } from "vitest";
import { add, money, mul, sub, toDecimal } from "@/lib/money";
import {
  calcularTotaisVenda,
  centsParaNumero,
  centsParaString,
  paraCentavos,
  paraEscala,
  paraMilesimos,
  parteEmDinheiroCents,
  somaParcelasCents,
  totalDaVendaCents,
  type ItemDaVenda,
} from "@/lib/venda/total";

/**
 * O módulo de totais é a fonte única do cálculo da venda — o navegador e o
 * servidor chamam a MESMA função. Este arquivo existe para provar duas coisas:
 *
 *  1. que ele reproduz exatamente o que o servidor já gravava em `Prisma.Decimal`
 *     (senão a correção reescreveria silenciosamente o histórico de vendas);
 *  2. que ele NÃO reproduz o que o PDV calculava em ponto flutuante — porque era
 *     justamente essa divergência o defeito.
 *
 * A referência abaixo é a cadeia `mul/money/add/sub` que estava em
 * `vendas.service.ts` antes da correção. Comparar contra ela não é tautológico:
 * o serviço de produção passa a usar só o módulo, então esta é a única cópia
 * que sobra do comportamento antigo.
 */
function referenciaEmDecimal(v: {
  items: ItemDaVenda[];
  discountAmount?: number | null;
}) {
  const brutos = v.items.map((i) => mul(i.quantity, i.unitPrice));
  const lineTotals = v.items.map((i, idx) => money(sub(brutos[idx]!, i.discountAmount ?? 0)));
  const subtotal = money(add(...brutos));
  const total = money(sub(add(...lineTotals), toDecimal(v.discountAmount ?? 0)));
  // `toFixed(2)` e não `toString()`: o Decimal imprime "83.7" onde o banco
  // guarda 83,70, e a diferença é de formatação, não de valor. Comparar em duas
  // casas fixas é comparar o que realmente vai para a coluna `Decimal(14,2)`.
  return {
    subtotal: subtotal.toFixed(2),
    total: total.toFixed(2),
    lineTotals: lineTotals.map((d) => d.toFixed(2)),
  };
}

/** Casos escolhidos para caírem em cima de meio-centavo e de binário inexato. */
const CASOS: { nome: string; venda: { items: ItemDaVenda[]; discountAmount?: number } }[] = [
  {
    nome: "quantidade que o browser monta como 0.30000000000000004",
    venda: { items: [{ quantity: 0.1 + 0.2, unitPrice: 10 }] },
  },
  {
    nome: "1.005 — meio centavo exato na repr curta",
    venda: { items: [{ quantity: 1, unitPrice: 1.005 }] },
  },
  {
    nome: "três itens de 3,333",
    venda: { items: [1, 2, 3].map(() => ({ quantity: 1, unitPrice: 3.333 })) },
  },
  {
    nome: "2,35 × 8",
    venda: { items: [{ quantity: 8, unitPrice: 2.35 }] },
  },
  {
    nome: "7 × 0,105",
    venda: { items: [{ quantity: 7, unitPrice: 0.105 }] },
  },
  {
    nome: "dois itens de 1,115 — o caso que divergia",
    venda: { items: [1, 2].map(() => ({ quantity: 1.115, unitPrice: 1 })) },
  },
  {
    nome: "desconto por linha e desconto da venda juntos",
    venda: {
      items: [
        { quantity: 3, unitPrice: 12.9, discountAmount: 1.45 },
        { quantity: 1.5, unitPrice: 7.77 },
      ],
      discountAmount: 2.05,
    },
  },
  {
    nome: "quantidade fracionada de três casas, como o schema permite",
    venda: { items: [{ quantity: 12.345, unitPrice: 6.78 }] },
  },
];

describe("calcularTotaisVenda bate com o Prisma.Decimal do servidor", () => {
  for (const { nome, venda } of CASOS) {
    it(nome, () => {
      const esperado = referenciaEmDecimal(venda);
      const obtido = calcularTotaisVenda(venda);

      expect(centsParaString(obtido.subtotalCents)).toBe(esperado.subtotal);
      expect(centsParaString(obtido.totalCents)).toBe(esperado.total);
      expect(obtido.lineTotalsCents.map(centsParaString)).toEqual(esperado.lineTotals);
    });
  }
});

describe("a divergência que existia entre a tela e o banco", () => {
  // Dois itens de 1,115 × R$ 1,00. O PDV arredondava a SOMA uma vez
  // (2,23); o servidor arredonda LINHA A LINHA e soma (1,12 + 1,12 = 2,24).
  const venda = { items: [1, 2].map(() => ({ quantity: 1.115, unitPrice: 1 })) };

  it("o total do módulo é o do servidor, não o do ponto flutuante", () => {
    const antigoDoPdv = Math.round(venda.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0) * 100) / 100;
    expect(antigoDoPdv).toBe(2.23);
    expect(centsParaNumero(totalDaVendaCents(venda))).toBe(2.24);
  });

  it("subtotal e soma das linhas podem legitimamente diferir de um centavo", () => {
    const t = calcularTotaisVenda(venda);
    // O subtotal é o bruto arredondado UMA vez; o total vem das linhas já
    // arredondadas. Um centavo de diferença aqui não é defeito — é o que o
    // banco guarda, e a tela de detalhe precisa exibir os dois como estão.
    expect(centsParaString(t.subtotalCents)).toBe("2.23");
    expect(centsParaString(t.totalCents)).toBe("2.24");
  });
});

describe("conversão para escala inteira", () => {
  it("lê da representação curta, como o Prisma.Decimal — e não do binário", () => {
    // (1.005).toFixed(2) === "1.00" porque lê 1.00499…; a repr curta é "1.005".
    expect(paraCentavos(1.005)).toBe(101n);
    expect(money(1.005).toFixed(2)).toBe("1.01");
  });

  it("resolve notação científica", () => {
    expect(paraEscala(1e-7, 8)).toBe(10n);
    expect(paraEscala("1.5e3", 2)).toBe(150000n);
    expect(paraCentavos(1e3)).toBe(100000n);
  });

  it("arredonda meio-para-cima afastando do zero", () => {
    expect(paraCentavos(2.345)).toBe(235n);
    expect(paraCentavos(-2.345)).toBe(-235n);
    expect(paraMilesimos(1.0005)).toBe(1001n);
  });

  it("aceita string sem perder casas", () => {
    expect(paraCentavos("0.01")).toBe(1n);
    expect(paraMilesimos("999.999")).toBe(999999n);
  });

  it("recusa entrada que não é número", () => {
    expect(() => paraCentavos("abc")).toThrow(/invalido/i);
    expect(() => paraCentavos("")).toThrow(/invalido/i);
  });

  it("centsParaString e centsParaNumero fecham o círculo", () => {
    expect(centsParaString(4200n)).toBe("42.00");
    expect(centsParaString(7n)).toBe("0.07");
    expect(centsParaString(0n)).toBe("0.00");
    expect(centsParaString(-150n)).toBe("-1.50");
    expect(centsParaNumero(4200n)).toBe(42);
  });
});

describe("desconto maior que a venda não vira total negativo", () => {
  it("trava em zero", () => {
    const t = calcularTotaisVenda({
      items: [{ quantity: 1, unitPrice: 10 }],
      discountAmount: 9999,
    });
    expect(centsParaString(t.totalCents)).toBe("0.00");
  });
});

describe("parte paga em dinheiro", () => {
  const items = [{ quantity: 1, unitPrice: 100 }];

  it("em venda mista, é só a parcela em espécie — não o total", () => {
    const parte = parteEmDinheiroCents({
      items,
      payments: [
        { method: "PIX", amount: 60 },
        { method: "DINHEIRO", amount: 40 },
      ],
    });
    expect(centsParaString(parte)).toBe("40.00");
  });

  it("em forma única de dinheiro, coincide com o total", () => {
    expect(centsParaString(parteEmDinheiroCents({ items, paymentMethod: "DINHEIRO" }))).toBe(
      "100.00",
    );
  });

  it("sem nenhuma parcela em espécie, é zero", () => {
    expect(parteEmDinheiroCents({ items, paymentMethod: "PIX" })).toBe(0n);
    expect(
      parteEmDinheiroCents({ items, payments: [{ method: "PIX", amount: 100 }] }),
    ).toBe(0n);
  });

  it("soma parcelas repetidas da mesma forma", () => {
    const parte = parteEmDinheiroCents({
      items,
      payments: [
        { method: "DINHEIRO", amount: 30 },
        { method: "DINHEIRO", amount: 10 },
        { method: "PIX", amount: 60 },
      ],
    });
    expect(centsParaString(parte)).toBe("40.00");
  });
});

describe("soma das parcelas", () => {
  it("soma em centavos, sem erro de ponto flutuante", () => {
    // 0.1 + 0.2 em float dá 0.30000000000000004; em centavos dá exatamente 30.
    const soma = somaParcelasCents([
      { method: "PIX", amount: 0.1 },
      { method: "DINHEIRO", amount: 0.2 },
    ]);
    expect(soma).toBe(30n);
  });

  it("lista vazia ou ausente soma zero", () => {
    expect(somaParcelasCents([])).toBe(0n);
    expect(somaParcelasCents(null)).toBe(0n);
    expect(somaParcelasCents(undefined)).toBe(0n);
  });
});
