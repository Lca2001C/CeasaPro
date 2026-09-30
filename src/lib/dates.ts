import {
  addDaysTz,
  civilParts,
  endOfDayTz,
  parseIsoDateTz,
  startOfDayTz,
  startOfMonthTz,
  startOfNextMonthTz,
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
  /**
   * Teto para o que é contado por VENCIMENTO (despesas).
   *
   * "Este mês" tem duas leituras, e o sistema usa as duas de propósito:
   *
   *  - venda, compra, pagamento — fatos que já aconteceram — vão "até agora"
   *    (`to`): venda com data futura não é faturamento realizado;
   *  - despesa por vencimento vai até o FIM DO MÊS: a conta fixa que vence dia
   *    20 é despesa deste mês desde o dia 1º.
   *
   * É a definição do Início ("Contas do mês", "Contas fixas", "Sobrou no
   * mês", em `DashboardService`) e de /despesas (`resumoMes`). O relatório de
   * despesas ia só "até hoje" e, no dia 8, dizia metade do que o Início
   * mostrava para o mesmo mês. Nos outros presets é igual a `to`.
   */
  toVencimento: Date;
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
 *
 * Só aceita uma data que EXISTE, em YYYY-MM-DD; o resto é `null`. Havia um
 * `?? new Date(v)` de reserva: "10/09/2026" virava 09/10 (mês e dia trocados),
 * "2026-02-31" virava 03/03, e texto qualquer dava `Invalid Date` — que
 * estourava no `toISOString()` do nome do arquivo exportado (500) ou chegava à
 * consulta como período sem sentido. Quem decide o que fazer com `null` é
 * {@link resolvePeriod}.
 */
function parseEntrada(v: string | Date): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  return parseIsoDateTz(v);
}

const PRESETS: readonly PeriodPreset[] = ["hoje", "semana", "mes", "mes_passado", "personalizado"];

/** O preset veio da URL: qualquer texto. Desconhecido vale "mes", o padrão. */
function presetValido(v: unknown): PeriodPreset {
  return PRESETS.includes(v as PeriodPreset) ? (v as PeriodPreset) : "mes";
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
  let preset = presetValido(input?.preset);

  // Período personalizado com data que não existe (ou início depois do fim)
  // cai no padrão, "Este mês" — em vez de um período inventado ou de um 500.
  let personalizado: { from: Date | null; to: Date | null } | null = null;
  if (preset === "personalizado") {
    const f = input?.from ? parseEntrada(input.from) : null;
    const t = input?.to ? parseEntrada(input.to) : null;
    const invalida = (input?.from && !f) || (input?.to && !t) || (f && f > (t ?? now));
    if (invalida) preset = "mes";
    else personalizado = { from: f, to: t };
  }

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
      from = startOfDay(personalizado?.from ?? startOfMonth(now));
      to = endOfDay(personalizado?.to ?? now);
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

  // Ver `Period.toVencimento`. A janela anterior (variação %) continua do
  // mesmo tamanho de `to`: comparar o mês inteiro com um pedaço do anterior
  // distorceria a variação.
  const toVencimento =
    preset === "mes" ? new Date(startOfNextMonthTz(now).getTime() - 1) : to;

  return { from, to, prevFrom, prevTo, preset, toVencimento };
}

function startOfMonth(d: Date): Date {
  return startOfMonthTz(d);
}

export { startOfDay, endOfDay, addDays, startOfMonth };
