/**
 * Fuso horário da aplicação.
 *
 * O CeasaPro é usado no CEASA brasileiro e o servidor roda na Vercel, em UTC.
 * Sem um fuso explícito, três coisas quebram de forma silenciosa:
 *
 *  - **Exibição:** `Intl.DateTimeFormat` sem `timeZone` usa o fuso do processo,
 *    então toda data renderizada no servidor aparecia 3 horas adiantada.
 *  - **Limite do dia:** `setHours(0,0,0,0)` zera no fuso do processo. "Hoje", no
 *    painel, começava às 21h do dia anterior — uma venda das 22h caía no dia
 *    seguinte, e o fechamento do dia nunca batia com o do balcão.
 *  - **Mês de referência da cobrança:** `getMonth()` no servidor vira o mês
 *    seguinte às 21h do último dia, gerando mensalidade no mês errado.
 *
 * As funções aqui são puras (só `Intl`) e valem no servidor e no browser —
 * o formulário e o relatório precisam concordar sobre que dia é hoje.
 */
export const APP_TIME_ZONE = "America/Sao_Paulo";

interface CivilParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Os campos de calendário ("que horas são aí") de um instante, no fuso do app. */
export function civilParts(date: Date): CivilParts {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Deslocamento do fuso, em ms, para um instante (negativo a oeste de Greenwich). */
export function offsetMs(date: Date): number {
  const c = civilParts(date);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  // Descarta os milissegundos dos dois lados: `civilParts` não os traz.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Instante UTC correspondente a uma data/hora civil NO FUSO DO APP.
 *
 * A segunda passada existe por causa de troca de horário de verão: o
 * deslocamento correto é o do instante de destino, não o do palpite inicial.
 * O Brasil não usa mais horário de verão desde 2019, mas datas históricas e
 * uma eventual volta da regra continuam corretas assim.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const primeiro = offsetMs(new Date(guess));
  const candidato = new Date(guess - primeiro);
  const segundo = offsetMs(candidato);
  return primeiro === segundo ? candidato : new Date(guess - segundo);
}

/** Primeiro instante do dia (00:00:00.000) no fuso do app. */
export function startOfDayTz(date: Date): Date {
  const c = civilParts(date);
  return zonedTimeToUtc(c.year, c.month, c.day, 0, 0, 0, 0);
}

/** Último instante do dia (23:59:59.999) no fuso do app. */
export function endOfDayTz(date: Date): Date {
  const c = civilParts(date);
  return zonedTimeToUtc(c.year, c.month, c.day, 23, 59, 59, 999);
}

/** Primeiro instante do mês, no fuso do app. */
export function startOfMonthTz(date: Date): Date {
  const c = civilParts(date);
  return zonedTimeToUtc(c.year, c.month, 1, 0, 0, 0, 0);
}

/** Primeiro instante do mês seguinte ao do instante dado, no fuso do app. */
export function startOfNextMonthTz(date: Date): Date {
  const c = civilParts(date);
  const mesSeguinte = c.month === 12 ? 1 : c.month + 1;
  const ano = c.month === 12 ? c.year + 1 : c.year;
  return zonedTimeToUtc(ano, mesSeguinte, 1, 0, 0, 0, 0);
}

/**
 * Soma dias mantendo a hora do dia no fuso do app.
 * Somar 24h em milissegundos daria resultado diferente numa virada de horário
 * de verão; aqui o dia do calendário é que anda.
 */
export function addDaysTz(date: Date, days: number): Date {
  const c = civilParts(date);
  return zonedTimeToUtc(c.year, c.month, c.day + days, c.hour, c.minute, c.second, 0);
}

/**
 * Data em "YYYY-MM-DD" no fuso do app.
 *
 * Substitui o `toISOString().slice(0, 10)` espalhado pelos formulários: às 22h
 * no Brasil aquele já devolvia a data de amanhã, então o campo "data da venda"
 * nascia com o dia errado justamente no fim do expediente.
 */
export function isoDateTz(date: Date = new Date()): string {
  const c = civilParts(date);
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

/**
 * Data/hora em ISO 8601 **com o deslocamento explícito** do fuso do app
 * (`2026-08-28T14:30:00.000-03:00`), em vez do `Z` de `toISOString()`.
 *
 * O Mercado Pago exige esse formato em `date_of_expiration` da cobrança PIX e
 * recusa a requisição quando recebe `Z` — o pedido volta 400 e o cliente vê um
 * erro sem conseguir gerar o código.
 */
export function isoComOffsetTz(date: Date): string {
  const c = civilParts(date);
  const p2 = (n: number) => String(n).padStart(2, "0");
  // Milissegundos não dependem de fuso; os campos civis já vieram convertidos.
  const ms = String(date.getUTCMilliseconds()).padStart(3, "0");

  const off = offsetMs(date);
  const sinal = off <= 0 ? "-" : "+";
  const minutos = Math.abs(off) / 60_000;
  const offset = `${sinal}${p2(Math.floor(minutos / 60))}:${p2(minutos % 60)}`;

  return `${c.year}-${p2(c.month)}-${p2(c.day)}T${p2(c.hour)}:${p2(c.minute)}:${p2(c.second)}.${ms}${offset}`;
}

/** Mês de referência ("YYYY-MM") no fuso do app. */
export function refMonthTz(date: Date = new Date()): string {
  const c = civilParts(date);
  return `${c.year}-${String(c.month).padStart(2, "0")}`;
}

/**
 * Converte "YYYY-MM-DD" (vindo de um `<input type="date">`) para o instante do
 * início daquele dia no fuso do app. `new Date("2026-08-26")` interpretaria
 * como meia-noite **UTC**, ou seja, 21h do dia 25 no Brasil.
 */
/**
 * Data escolhida num `<input type="date">`.
 *
 * O "YYYY-MM-DD" que o navegador manda significa aquele dia **no Brasil**, mas
 * `new Date(v)` o lê como meia-noite UTC — 21h do dia anterior aqui. O efeito
 * aparecia na cara do usuário: vencimento digitado 10/09 voltava 09/09 na tela
 * (o formatador usa APP_TIME_ZONE) e a conta nascia vencida um dia antes do
 * combinado. Valor que já venha com hora (ISO completo) passa direto.
 */
export function parseFormDateTz(value: string): Date {
  return parseIsoDateTz(value) ?? new Date(value);
}

export function parseIsoDateTz(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0, 0);
}
