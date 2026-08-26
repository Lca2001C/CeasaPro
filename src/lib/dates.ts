import {
  addDaysTz,
  civilParts,
  endOfDayTz,
  parseIsoDateTz,
  startOfDayTz,
  startOfMonthTz,
  zonedTimeToUtc,
} from "./tz";

export type PeriodPreset =
  | "hoje"
  | "semana"
  | "mes"
  | "mes_passado"
  | "personalizado";

export interface Period {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  preset: PeriodPreset;
}

// Todos os limites de dia/mês são calculados no fuso do app (ver `tz.ts`).
// Com `setHours`/`getDate` puros, o servidor da Vercel (UTC) fazia o dia virar
// às 21h no Brasil: a venda das 22h entrava no relatório do dia seguinte.
function startOfDay(d: Date): Date {
  return startOfDayTz(d);
}

function endOfDay(d: Date): Date {
  return endOfDayTz(d);
}

function addDays(d: Date, days: number): Date {
  return addDaysTz(d, days);
}

/**
 * Interpreta o que veio do filtro de período.
 *
 * "2026-08-26" precisa significar o dia 26 **no Brasil**. `new Date("2026-08-26")`
 * daria meia-noite UTC, que é 21h do dia 25 aqui — e o relatório personalizado
 * começaria um dia antes do que o usuário escolheu.
 */
function parseEntrada(v: string | Date): Date {
  if (v instanceof Date) return v;
  return parseIsoDateTz(v) ?? new Date(v);
}

/**
 * Resolve um período a partir de um preset ou datas explícitas.
 * Retorna também a janela anterior de mesmo tamanho (para variação % nos cards).
 */
export function resolvePeriod(input?: {
  preset?: PeriodPreset;
  from?: string | Date;
  to?: string | Date;
  now?: Date;
}): Period {
  const now = input?.now ?? new Date();
  const preset = input?.preset ?? "mes";

  let from: Date;
  let to: Date = endOfDay(now);

  switch (preset) {
    case "hoje":
      from = startOfDay(now);
      break;
    case "semana": {
      // últimos 7 dias (inclui hoje)
      from = startOfDay(addDays(now, -6));
      break;
    }
    case "mes_passado": {
      const c = civilParts(now);
      // Dia 0 do mês atual = último dia do mês passado, no fuso do app.
      const first = zonedTimeToUtc(c.year, c.month - 1, 1);
      const last = zonedTimeToUtc(c.year, c.month, 0);
      from = startOfDay(first);
      to = endOfDay(last);
      break;
    }
    case "personalizado": {
      from = startOfDay(input?.from ? parseEntrada(input.from) : startOfMonth(now));
      to = endOfDay(input?.to ? parseEntrada(input.to) : now);
      break;
    }
    case "mes":
    default:
      from = startOfDay(startOfMonth(now));
      break;
  }

  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs);

  return { from, to, prevFrom, prevTo, preset };
}

function startOfMonth(d: Date): Date {
  return startOfMonthTz(d);
}

export { startOfDay, endOfDay, addDays, startOfMonth };
