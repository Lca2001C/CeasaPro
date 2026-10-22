import { describe, it, expect } from "vitest";
import {
  addOneMonth,
  ancoraCoerente,
  ancoraDoVencimento,
  diaCivil,
  subOneMonth,
} from "@/lib/billing/status";
import { civilParts } from "@/lib/tz";

/**
 * Vencimento mensal pelo DIA ÂNCORA da assinatura.
 *
 * A renovação partia do vencimento já ajustado: 31/01 → 28/02 → 28/03 → 28/04,
 * e a assinatura nunca mais voltava ao 31. Com a âncora, cada mês vai ao dia
 * original, limitado ao último dia do mês de destino.
 */

const brt = (iso: string) => new Date(`${iso}-03:00`);
function dia(d: Date): string {
  const c = civilParts(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${c.year}-${p(c.month)}-${p(c.day)}`;
}

/** Os N vencimentos seguintes, encadeados como a aprovação faz. */
function cadeia(inicio: string, ancora: number, n: number): string[] {
  let atual = brt(`${inicio}T10:00:00`);
  const saida: string[] = [];
  for (let i = 0; i < n; i++) {
    atual = addOneMonth(atual, ancora);
    saida.push(dia(atual));
  }
  return saida;
}

describe("dia âncora 31", () => {
  it("ano não bissexto: 31/01 → 28/02 → 31/03 → 30/04 → 31/05", () => {
    expect(cadeia("2027-01-31", 31, 4)).toEqual([
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
  });

  it("ano bissexto: 31/01 → 29/02 → 31/03", () => {
    expect(cadeia("2028-01-31", 31, 2)).toEqual(["2028-02-29", "2028-03-31"]);
  });

  it("um ano inteiro sem perder a âncora", () => {
    expect(cadeia("2027-01-31", 31, 12)).toEqual([
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
      "2027-06-30",
      "2027-07-31",
      "2027-08-31",
      "2027-09-30",
      "2027-10-31",
      "2027-11-30",
      "2027-12-31",
      "2028-01-31",
    ]);
  });

  it("sem a âncora, o cálculo antigo deslizava para o 28 (o defeito)", () => {
    let atual = brt("2027-01-31T10:00:00");
    for (let i = 0; i < 3; i++) atual = addOneMonth(atual);
    expect(dia(atual)).toBe("2027-04-28");
  });
});

describe("dias âncora 29 e 30", () => {
  it("29: 29/01 → 28/02 → 29/03 (não bissexto)", () => {
    expect(cadeia("2027-01-29", 29, 2)).toEqual(["2027-02-28", "2027-03-29"]);
  });

  it("29 em ano bissexto: 29/01 → 29/02 → 29/03", () => {
    expect(cadeia("2028-01-29", 29, 2)).toEqual(["2028-02-29", "2028-03-29"]);
  });

  it("30: 30/01 → 28/02 → 30/03 → 30/04", () => {
    expect(cadeia("2027-01-30", 30, 3)).toEqual(["2027-02-28", "2027-03-30", "2027-04-30"]);
  });
});

describe("dia âncora 28 (cabe em todo mês)", () => {
  it("28/01 → 28/02 → 28/03", () => {
    expect(cadeia("2027-01-28", 28, 2)).toEqual(["2027-02-28", "2027-03-28"]);
  });
});

describe("virada de ano", () => {
  it("31/12 → 31/01 → 28/02", () => {
    expect(cadeia("2027-12-31", 31, 2)).toEqual(["2028-01-31", "2028-02-29"]);
  });

  it("15/12 → 15/01", () => {
    expect(cadeia("2026-12-15", 15, 1)).toEqual(["2027-01-15"]);
  });
});

describe("fuso: a âncora é o dia CIVIL de Brasília", () => {
  it("22 h de 30/01 (já 31/01 em UTC) tem âncora 30, não 31", () => {
    const pago = brt("2027-01-30T22:00:00");
    expect(diaCivil(pago)).toBe(30);
    expect(dia(addOneMonth(pago, diaCivil(pago)))).toBe("2027-02-28");
    expect(dia(addOneMonth(addOneMonth(pago, 30), 30))).toBe("2027-03-30");
  });

  it("a hora do dia é mantida", () => {
    const v = addOneMonth(brt("2027-02-28T22:30:00"), 31);
    const c = civilParts(v);
    expect([c.day, c.hour, c.minute]).toEqual([31, 22, 30]);
  });
});

describe("subOneMonth: recuar um mês pago (estorno)", () => {
  it("31/03 com âncora 31 recua para 28/02, não para 03/03", () => {
    expect(dia(subOneMonth(brt("2027-03-31T10:00:00"), 31))).toBe("2027-02-28");
  });

  it("31/01 recua para 31/12 do ano anterior", () => {
    expect(dia(subOneMonth(brt("2027-01-31T10:00:00"), 31))).toBe("2026-12-31");
  });

  it("28/02 com âncora 31 recua para 31/01", () => {
    expect(dia(subOneMonth(brt("2027-02-28T10:00:00"), 31))).toBe("2027-01-31");
  });
});

describe("âncora inválida é ignorada (vale o dia da partida)", () => {
  it.each([0, 32, -1, null, undefined])("%s", (ancora) => {
    expect(dia(addOneMonth(brt("2027-03-15T10:00:00"), ancora))).toBe("2027-04-15");
  });
});

describe("âncora coerente com o vencimento", () => {
  it("28/02 é coerente com 28, 29, 30 e 31; 30/04 com 30 e 31", () => {
    for (const a of [28, 29, 30, 31]) expect(ancoraCoerente(brt("2027-02-28T10:00:00"), a)).toBe(true);
    expect(ancoraCoerente(brt("2027-04-30T10:00:00"), 31)).toBe(true);
    expect(ancoraCoerente(brt("2027-04-30T10:00:00"), 30)).toBe(true);
  });

  it("vencimento fora da âncora (mexido à mão) não é coerente", () => {
    expect(ancoraCoerente(brt("2027-03-24T10:00:00"), 22)).toBe(false);
    expect(ancoraCoerente(brt("2027-04-30T10:00:00"), 29)).toBe(false);
  });

  it("incoerente, vale o dia do vencimento", () => {
    expect(ancoraDoVencimento(brt("2027-03-24T10:00:00"), 22)).toBe(24);
    expect(ancoraDoVencimento(brt("2027-02-28T10:00:00"), 31)).toBe(31);
    expect(ancoraDoVencimento(brt("2027-03-24T10:00:00"), null)).toBe(24);
  });
});
