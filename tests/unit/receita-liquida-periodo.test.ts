import { describe, it, expect } from "vitest";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { resolvePeriod } from "@/lib/dates";

const s = (xs: { toString(): string }[]) => xs.map((x) => x.toString());

describe("FinancialCalc.receitaLiquidaPorLinha — desconto da venda rateado", () => {
  it("rateia proporcional ao valor da linha", () => {
    // Linhas 60 + 40, desconto de 20 → total 80.
    expect(s(FinancialCalc.receitaLiquidaPorLinha([60, 40], 80))).toEqual(["48", "32"]);
  });

  it("sem desconto, as linhas voltam como estão", () => {
    expect(s(FinancialCalc.receitaLiquidaPorLinha([10.5, 4.25], 14.75))).toEqual(["10.5", "4.25"]);
  });

  it("a soma das partes é sempre o total, mesmo com resíduo de centavo", () => {
    const partes = FinancialCalc.receitaLiquidaPorLinha([10, 10, 10], 20);
    const soma = partes.reduce((a, p) => a.plus(p), partes[0]!.minus(partes[0]!));
    expect(soma.toString()).toBe("20");
    expect(partes.every((p) => !p.isNegative())).toBe(true);
  });

  it("total zero (desconto do tamanho da venda) zera todas as linhas", () => {
    expect(s(FinancialCalc.receitaLiquidaPorLinha([30, 70], 0))).toEqual(["0", "0"]);
  });

  it("venda sem linhas", () => {
    expect(FinancialCalc.receitaLiquidaPorLinha([], 0)).toEqual([]);
  });
});

describe("resolvePeriod — data inválida cai no padrão (regressão)", () => {
  const agora = new Date("2026-08-26T15:00:00.000Z");
  const mes = resolvePeriod({ preset: "mes", now: agora });

  it.each([
    ["dd/mm/aaaa", "10/08/2026", "2026-08-20"],
    ["data que não existe", "2026-02-31", "2026-08-20"],
    ["texto qualquer", "ontem", "2026-08-20"],
    ["fim inválido", "2026-08-10", "2026-13-01"],
    ["início depois do fim", "2026-08-20", "2026-08-10"],
  ])("%s → 'Este mês'", (_caso, from, to) => {
    const p = resolvePeriod({ preset: "personalizado", from, to, now: agora });
    expect(p.preset).toBe("mes");
    expect(p.from.getTime()).toBe(mes.from.getTime());
    expect(p.to.getTime()).toBe(mes.to.getTime());
    expect(Number.isNaN(p.from.getTime())).toBe(false);
  });

  it("preset desconhecido vira 'mes'", () => {
    const p = resolvePeriod({ preset: "xyz" as never, now: agora });
    expect(p.preset).toBe("mes");
    expect(p.from.getTime()).toBe(mes.from.getTime());
  });

  it("período personalizado válido continua valendo", () => {
    const p = resolvePeriod({ preset: "personalizado", from: "2026-08-10", to: "2026-08-10", now: agora });
    expect(p.preset).toBe("personalizado");
    expect(p.from.toISOString()).toBe("2026-08-10T03:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-08-11T02:59:59.999Z");
  });
});

describe("resolvePeriod — teto por vencimento (toVencimento)", () => {
  // 26/08 às 12h em São Paulo.
  const agora = new Date("2026-08-26T15:00:00.000Z");

  it("'Este mês': fatos vão até hoje, vencimentos até o fim do mês", () => {
    const p = resolvePeriod({ preset: "mes", now: agora });
    // Fim de 26/08 no Brasil.
    expect(p.to.toISOString()).toBe("2026-08-27T02:59:59.999Z");
    // Fim de 31/08 no Brasil — a janela do Início e de /despesas.
    expect(p.toVencimento.toISOString()).toBe("2026-09-01T02:59:59.999Z");
  });

  it("a janela anterior (variação %) não muda com o teto de vencimento", () => {
    const p = resolvePeriod({ preset: "mes", now: agora });
    expect(p.prevTo.getTime()).toBe(p.from.getTime() - 1);
    expect(p.prevTo.getTime() - p.prevFrom.getTime()).toBe(p.to.getTime() - p.from.getTime());
  });

  it.each(["hoje", "semana", "mes_passado"] as const)("'%s': toVencimento = to", (preset) => {
    const p = resolvePeriod({ preset, now: agora });
    expect(p.toVencimento.getTime()).toBe(p.to.getTime());
  });

  it("personalizado: o usuário escolheu o fim, e ele vale para os dois", () => {
    const p = resolvePeriod({
      preset: "personalizado",
      from: "2026-08-01",
      to: "2026-08-10",
      now: agora,
    });
    expect(p.toVencimento.getTime()).toBe(p.to.getTime());
  });

  it("dezembro vira o ano sem sair do fuso", () => {
    const p = resolvePeriod({ preset: "mes", now: new Date("2026-12-10T15:00:00.000Z") });
    expect(p.toVencimento.toISOString()).toBe("2027-01-01T02:59:59.999Z");
  });
});
