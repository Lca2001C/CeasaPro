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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
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
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      from = startOfDay(first);
      to = endOfDay(last);
      break;
    }
    case "personalizado": {
      from = startOfDay(input?.from ? new Date(input.from) : startOfMonth(now));
      to = endOfDay(input?.to ? new Date(input.to) : now);
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
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export { startOfDay, endOfDay, addDays, startOfMonth };
