import { describe, it, expect } from "vitest";
import { calcularCustoDaCarga, nomeDaEmbalagem } from "@/lib/estoque/custo-carga";

describe("calcularCustoDaCarga", () => {
  it("só mercadoria", () => {
    expect(calcularCustoDaCarga(50, 4.5, null)).toEqual({
      custoUnitario: 4.5,
      totalMercadoria: 225,
      totalDescarga: 0,
      total: 225,
    });
  });

  it("só descarga", () => {
    expect(calcularCustoDaCarga(50, null, 1)).toEqual({
      custoUnitario: 1,
      totalMercadoria: 0,
      totalDescarga: 50,
      total: 50,
    });
  });

  it("as duas somam no custo por unidade e no total", () => {
    expect(calcularCustoDaCarga(50, 20, 1)).toEqual({
      custoUnitario: 21,
      totalMercadoria: 1000,
      totalDescarga: 50,
      total: 1050,
    });
  });

  it("não acumula erro de ponto flutuante", () => {
    const r = calcularCustoDaCarga(3, 1.1, 0.2);
    expect(r.custoUnitario).toBe(1.3);
    expect(r.totalMercadoria).toBe(3.3);
    expect(r.total).toBe(3.9);
  });

  it("quantidade fracionada (kg) arredonda para o centavo", () => {
    const r = calcularCustoDaCarga(12.345, 3.33, 0.5);
    expect(r.totalMercadoria).toBe(41.11);
    expect(r.totalDescarga).toBe(6.17);
    expect(r.total).toBe(47.28);
  });

  it("nenhum custo informado: sem custo por unidade", () => {
    expect(calcularCustoDaCarga(10, null, null).custoUnitario).toBeNull();
    expect(calcularCustoDaCarga(10, 0, null).custoUnitario).toBe(0);
  });

  it("sem quantidade, os totais são zero", () => {
    expect(calcularCustoDaCarga(null, 5, 1).total).toBe(0);
    expect(calcularCustoDaCarga(0, 5, 1).total).toBe(0);
  });
});

describe("nomeDaEmbalagem", () => {
  it("singular e plural", () => {
    expect(nomeDaEmbalagem("BANDEJA", 1)).toBe("bandeja");
    expect(nomeDaEmbalagem("BANDEJA", 50)).toBe("bandejas");
    expect(nomeDaEmbalagem("KG", 3)).toBe("kg");
  });
});
