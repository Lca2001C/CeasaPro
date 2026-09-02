import { toNumber, type Numeric } from "./money";
import { APP_TIME_ZONE } from "./tz";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const NUM = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});

// `timeZone` explícito: sem ele o formatador usa o fuso do processo, que na
// Vercel é UTC — toda data renderizada no servidor saía 3 horas adiantada.
const DATE = new Intl.DateTimeFormat("pt-BR", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DATETIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** R$ 1.234,56 */
export function formatBRL(v: Numeric | null | undefined): string {
  return BRL.format(toNumber(v ?? 0));
}

export function formatQty(v: Numeric | null | undefined): string {
  return NUM.format(toNumber(v ?? 0));
}

/**
 * Ajusta um valor já formatado para caber em espaço estreito (cartão de número
 * no celular), corrigindo duas armadilhas do `Intl.NumberFormat`:
 *
 * 1. **Espaço fixo entre "R$" e o número.** O `Intl` usa NBSP (U+00A0), que
 *    proíbe quebra de linha. Resultado: "R$ 11.000,00" é um único bloco
 *    indivisível e ESTOURA a caixa em vez de se ajustar. Trocando por espaço
 *    comum, a pior hipótese passa a ser o "R$" descer para a linha de baixo —
 *    com os dígitos inteiros, que é o que precisa ser lido junto.
 * 2. **Hífen-menos no negativo.** U+002D permite quebra depois dele, então
 *    "-R$ 950,00" quebrava como "-" numa linha e "R$ 950,00" na outra: o sinal
 *    fica órfão e dá para não perceber que o valor é negativo — num painel
 *    financeiro isso inverte a leitura de prejuízo para lucro. O sinal de menos
 *    tipográfico (U+2212) não abre quebra e ainda alinha melhor com os dígitos.
 *
 * Só para exibição. `formatBRL` continua intacto, porque é ele que vai para
 * exportação e e-mail, onde estes caracteres não devem mudar.
 */
export function valorExibivel(s: string): string {
  // ATENÇÃO: os dois caracteres abaixo são LITERAIS e invisíveis no editor — o
  // primeiro padrão é um NBSP (U+00A0) e a substituição do sinal é um U+2212.
  // Uma edição distraída os troca por espaço e hífen comuns sem que nada pareça
  // diferente, e o defeito volta calado. É por isso que existe
  // `tests/unit/valor-exibivel.test.ts` conferindo os pontos de código.
  return s.replace(/ /g, " ").replace(/^-/, "−");
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "-";
  return DATE.format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "-";
  return DATETIME.format(new Date(d));
}

/** (31) 99999-9999 */
export function formatPhone(v: string | null | undefined): string {
  if (!v) return "-";
  const digits = v.replace(/\D/g, "");
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return v;
}

export function formatCNPJ(v: string | null | undefined): string {
  if (!v) return "-";
  const d = v.replace(/\D/g, "");
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
