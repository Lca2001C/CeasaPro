import { describe, it, expect } from "vitest";
import { FinancialCalc } from "@/lib/services/financial-calc.service";

describe("FinancialCalc", () => {
  it("valorTotalCompra = qtd * preço + frete", () => {
    expect(FinancialCalc.valorTotalCompra(10, "2.50", 5).toString()).toBe("30");
  });

  it("custoRealUnitario dilui o frete", () => {
    // (10*2 + 5)/10 = 2.5
    expect(FinancialCalc.custoRealUnitario(10, 2, 5).toString()).toBe("2.5");
  });

  it("custoRealUnitario protege divisão por zero", () => {
    expect(FinancialCalc.custoRealUnitario(0, 3, 5).toString()).toBe("3");
  });

  it("ratearFrete distribui proporcional ao valor da linha", () => {
    const shares = FinancialCalc.ratearFrete([100, 300], 40); // 25% / 75%
    expect(shares.map((s) => s.toString())).toEqual(["10", "30"]);
  });

  // Consignação/bonificação: todas as linhas a R$ 0. Antes cada item recebia
  // R$ 0 de frete e o caminhão sumia do custo do estoque e do CMV.
  it("ratearFrete com compra de valor zero rateia pela quantidade", () => {
    const shares = FinancialCalc.ratearFrete([0, 0], 200, [30, 10]);
    expect(shares.map((s) => s.toString())).toEqual(["150", "50"]);
  });

  it("ratearFrete com valor zero e sem quantidades divide em partes iguais", () => {
    const shares = FinancialCalc.ratearFrete([0, 0, 0, 0], 100);
    expect(shares.map((s) => s.toString())).toEqual(["25", "25", "25", "25"]);
  });

  it("ratearFrete: as partes SEMPRE somam o frete (resíduo do arredondamento)", () => {
    // 0,10 em três linhas iguais: 0,03 × 3 = 0,09 — faltava um centavo.
    const a = FinancialCalc.ratearFrete([10, 10, 10], "0.10");
    expect(a.reduce((s, x) => s.plus(x), a[0]!.minus(a[0]!)).toString()).toBe("0.1");
    // 0,20 em três: 0,07 × 3 = 0,21 — sobrava um centavo.
    const b = FinancialCalc.ratearFrete([10, 10, 10], "0.20");
    expect(b.reduce((s, x) => s.plus(x), b[0]!.minus(b[0]!)).toString()).toBe("0.2");
  });

  it("ratearFrete nunca joga o resíduo numa linha de parte zero (frete negativo)", () => {
    // A linha bonificada (R$ 0) fica com R$ 0; o ajuste vai para a de maior parte.
    const shares = FinancialCalc.ratearFrete([10, 10, 10, 0], "0.20");
    expect(shares[3]!.toString()).toBe("0");
    expect(shares.every((s) => !s.isNegative())).toBe(true);
    expect(shares.reduce((s, x) => s.plus(x), shares[0]!.minus(shares[0]!)).toString()).toBe("0.2");
  });

  it("ratearFrete sem frete devolve zeros", () => {
    expect(FinancialCalc.ratearFrete([10, 20], 0).map((s) => s.toString())).toEqual(["0", "0"]);
  });

  it("valorTotalVenda = qtd * valor", () => {
    expect(FinancialCalc.valorTotalVenda(3, "4.99").toString()).toBe("14.97");
  });

  it("lucroBruto = vendido - CMV", () => {
    expect(FinancialCalc.lucroBruto(1000, 600).toString()).toBe("400");
  });

  it("lucroLiquido = lucroBruto - despesas (pode ser negativo)", () => {
    expect(FinancialCalc.lucroLiquido(400, 500).toString()).toBe("-100");
  });

  it("margemLiquida retorna 0 quando não há vendas (sem NaN/Infinity)", () => {
    expect(FinancialCalc.margemLiquida(100, 0).toString()).toBe("0");
  });

  it("margemLiquida calcula percentual", () => {
    // (200/1000)*100 = 20
    expect(FinancialCalc.margemLiquida(200, 1000).toString()).toBe("20");
  });

  it("saldoFiado nunca é negativo", () => {
    expect(FinancialCalc.saldoFiado(100, 120).toString()).toBe("0");
    expect(FinancialCalc.saldoFiado(100, 30).toString()).toBe("70");
  });

  it("totaisDespesas separa fixas e variáveis", () => {
    const t = FinancialCalc.totaisDespesas([
      { type: "FIXA", amount: 100 },
      { type: "FIXA", amount: 50 },
      { type: "VARIAVEL", amount: 25 },
    ]);
    expect(t.fixas.toString()).toBe("150");
    expect(t.variaveis.toString()).toBe("25");
    expect(t.geral.toString()).toBe("175");
  });

  it("valorTotalEstoque = Σ(qtd * custo)", () => {
    const v = FinancialCalc.valorTotalEstoque([
      { quantidade: 10, custoUnitario: "2.50" },
      { quantidade: 4, custoUnitario: "1.00" },
    ]);
    expect(v.toString()).toBe("29");
  });

  it("precisão decimal em somatório (sem erro de float)", () => {
    // 0.1 + 0.2 deveria ser 0.3, não 0.30000000000000004
    const v = FinancialCalc.valorTotalCompra(1, "0.1", "0.2");
    expect(v.toString()).toBe("0.3");
  });
});
