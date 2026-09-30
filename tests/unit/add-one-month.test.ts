import { describe, it, expect } from "vitest";
import { addOneMonth } from "@/lib/billing/status";
import { civilParts } from "@/lib/tz";

/**
 * `addOneMonth` é quem decide até quando vale o mês pago.
 *
 * A conta era em UTC. O Brasil está 3 h atrás, então das 21 h à meia-noite a
 * data UTC já é a do dia seguinte — e o "mesmo dia do mês que vem" saía do dia
 * errado. Quem pagava às 22 h de 30/08 recebia vencimento em 29/09 às 22 h:
 * um dia do mês pago a menos.
 */

/** Instante a partir de uma data/hora civil de Brasília (UTC−3, sem horário de verão). */
const brt = (iso: string) => new Date(`${iso}-03:00`);

/** Data/hora civil de Brasília do instante, para comparar de forma legível. */
function emBrt(d: Date): string {
  const c = civilParts(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${c.year}-${p(c.month)}-${p(c.day)}T${p(c.hour)}:${p(c.minute)}:${p(c.second)}`;
}

describe("addOneMonth — mês civil no fuso do app", () => {
  it("meio do dia: mesmo dia e mesma hora do mês seguinte", () => {
    expect(emBrt(addOneMonth(brt("2026-08-10T14:30:00")))).toBe("2026-09-10T14:30:00");
  });

  it("22 h de 30/08 (já 31/08 em UTC) vence 30/09 às 22 h, não 29/09", () => {
    const pago = brt("2026-08-30T22:00:00");
    expect(pago.toISOString()).toBe("2026-08-31T01:00:00.000Z"); // premissa do bug
    expect(emBrt(addOneMonth(pago))).toBe("2026-09-30T22:00:00");
  });

  it("22 h de 30/01 vence 28/02 às 22 h (o UTC dava 27/02)", () => {
    expect(emBrt(addOneMonth(brt("2027-01-30T22:00:00")))).toBe("2027-02-28T22:00:00");
  });

  it("mantém o limite do mês: 31/01 → 28/02, 31/08 → 30/09", () => {
    expect(emBrt(addOneMonth(brt("2027-01-31T10:00:00")))).toBe("2027-02-28T10:00:00");
    expect(emBrt(addOneMonth(brt("2026-08-31T10:00:00")))).toBe("2026-09-30T10:00:00");
  });

  it("ano bissexto: 31/01/2028 → 29/02/2028", () => {
    expect(emBrt(addOneMonth(brt("2028-01-31T23:30:00")))).toBe("2028-02-29T23:30:00");
  });

  it("dezembro vira janeiro do ano seguinte, inclusive na noite de 31/12", () => {
    expect(emBrt(addOneMonth(brt("2026-12-15T09:00:00")))).toBe("2027-01-15T09:00:00");
    expect(emBrt(addOneMonth(brt("2026-12-31T23:00:00")))).toBe("2027-01-31T23:00:00");
  });

  it("preserva os milissegundos e não muta a entrada", () => {
    const de = new Date("2026-03-05T12:34:56.789Z");
    const antes = de.getTime();
    const ate = addOneMonth(de);
    expect(ate.getUTCMilliseconds()).toBe(789);
    expect(de.getTime()).toBe(antes);
  });

  it("sempre avança (nunca devolve o mesmo instante ou um anterior)", () => {
    for (let d = 1; d <= 31; d++) {
      for (const h of ["00:00:00", "12:00:00", "21:30:00", "23:59:59"]) {
        const de = brt(`2026-01-${String(d).padStart(2, "0")}T${h}`);
        expect(addOneMonth(de).getTime()).toBeGreaterThan(de.getTime());
      }
    }
  });
});
