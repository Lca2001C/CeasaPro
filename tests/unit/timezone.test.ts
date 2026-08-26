import { describe, it, expect } from "vitest";
import {
  addDaysTz,
  civilParts,
  endOfDayTz,
  isoDateTz,
  parseIsoDateTz,
  refMonthTz,
  startOfDayTz,
  startOfMonthTz,
  zonedTimeToUtc,
} from "@/lib/tz";
import { resolvePeriod } from "@/lib/dates";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * O servidor roda em UTC (Vercel) e o usuário está no Brasil. Estes testes
 * fixam o comportamento nas bordas — 21h/22h e virada de mês — que é onde o
 * fuso errado se manifestava.
 */
describe("fuso do app (America/Sao_Paulo)", () => {
  // 26/08/2026 23:30 no Brasil = 27/08/2026 02:30 UTC.
  const noiteNoBrasil = new Date("2026-08-27T02:30:00.000Z");

  it("lê os campos civis no fuso brasileiro, não em UTC", () => {
    const c = civilParts(noiteNoBrasil);
    expect(c.day).toBe(26);
    expect(c.hour).toBe(23);
  });

  it("uma venda das 23h30 ainda pertence ao dia 26", () => {
    expect(isoDateTz(noiteNoBrasil)).toBe("2026-08-26");
    // O jeito antigo devolvia 27 — a venda caía no relatório do dia seguinte.
    expect(noiteNoBrasil.toISOString().slice(0, 10)).toBe("2026-08-27");
  });

  it("o dia começa às 03:00 UTC e termina às 02:59:59.999 do dia seguinte", () => {
    expect(startOfDayTz(noiteNoBrasil).toISOString()).toBe("2026-08-26T03:00:00.000Z");
    expect(endOfDayTz(noiteNoBrasil).toISOString()).toBe("2026-08-27T02:59:59.999Z");
  });

  it("o mês de referência não vira antes da hora", () => {
    // 31/08/2026 22:00 no Brasil = 01/09/2026 01:00 UTC.
    const fimDoMes = new Date("2026-09-01T01:00:00.000Z");
    expect(refMonthTz(fimDoMes)).toBe("2026-08");
    // Sem fuso, a mensalidade nasceria marcada como setembro.
    expect(fimDoMes.toISOString().slice(0, 7)).toBe("2026-09");
  });

  it("início do mês é a meia-noite brasileira do dia 1º", () => {
    expect(startOfMonthTz(noiteNoBrasil).toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it("somar dias anda no calendário, mantendo a hora local", () => {
    const depois = addDaysTz(noiteNoBrasil, 5);
    const c = civilParts(depois);
    expect(c.day).toBe(31);
    expect(c.hour).toBe(23);
  });

  it("zonedTimeToUtc e civilParts são inversos", () => {
    const d = zonedTimeToUtc(2026, 2, 28, 14, 45, 30);
    const c = civilParts(d);
    expect([c.year, c.month, c.day, c.hour, c.minute]).toEqual([2026, 2, 28, 14, 45]);
  });

  it('parseIsoDateTz lê "2026-08-26" como o dia 26 no Brasil', () => {
    const d = parseIsoDateTz("2026-08-26");
    expect(d?.toISOString()).toBe("2026-08-26T03:00:00.000Z");
    // `new Date("2026-08-26")` seria meia-noite UTC = 21h do dia 25 aqui.
    expect(civilParts(new Date("2026-08-26")).day).toBe(25);
  });

  it("parseIsoDateTz recusa entrada que não é data ISO", () => {
    expect(parseIsoDateTz("26/08/2026")).toBeNull();
    expect(parseIsoDateTz("")).toBeNull();
  });
});

describe("formatação", () => {
  it("mostra a hora brasileira, não a do servidor", () => {
    const d = new Date("2026-08-27T02:30:00.000Z");
    expect(formatDate(d)).toBe("26/08/2026");
    expect(formatDateTime(d)).toContain("26/08/2026");
    expect(formatDateTime(d)).toContain("23:30");
  });
});

describe("períodos do painel", () => {
  const agora = new Date("2026-08-27T02:30:00.000Z"); // 26/08 23:30 no Brasil

  it('"hoje" cobre o dia brasileiro inteiro', () => {
    const p = resolvePeriod({ preset: "hoje", now: agora });
    expect(p.from.toISOString()).toBe("2026-08-26T03:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-08-27T02:59:59.999Z");
    // A venda das 23h30 precisa estar dentro do "hoje".
    expect(agora >= p.from && agora <= p.to).toBe(true);
  });

  it('"mês" começa no dia 1º brasileiro', () => {
    const p = resolvePeriod({ preset: "mes", now: agora });
    expect(p.from.toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it('"mês passado" cobre julho inteiro', () => {
    const p = resolvePeriod({ preset: "mes_passado", now: agora });
    expect(p.from.toISOString()).toBe("2026-07-01T03:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-08-01T02:59:59.999Z");
  });

  it("período personalizado respeita o dia escolhido", () => {
    const p = resolvePeriod({
      preset: "personalizado",
      from: "2026-08-10",
      to: "2026-08-20",
      now: agora,
    });
    expect(p.from.toISOString()).toBe("2026-08-10T03:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-08-21T02:59:59.999Z");
  });
});
