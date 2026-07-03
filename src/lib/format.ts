import { toNumber, type Numeric } from "./money";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const NUM = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});

const DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DATETIME = new Intl.DateTimeFormat("pt-BR", {
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

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return DATE.format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return DATETIME.format(new Date(d));
}

/** (31) 99999-9999 */
export function formatPhone(v: string | null | undefined): string {
  if (!v) return "—";
  const digits = v.replace(/\D/g, "");
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return v;
}

export function formatCNPJ(v: string | null | undefined): string {
  if (!v) return "—";
  const d = v.replace(/\D/g, "");
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
