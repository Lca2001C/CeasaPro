import { Prisma } from "@prisma/client";

/** Valor monetário/quantidade sempre via Decimal (nunca Float). */
export type Numeric = Prisma.Decimal | number | string;

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export function toDecimal(v: Numeric | null | undefined): Prisma.Decimal {
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(v as Prisma.Decimal.Value);
}

export function add(...values: Numeric[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (acc, v) => acc.plus(toDecimal(v)),
    new Prisma.Decimal(0),
  );
}

export function sub(a: Numeric, b: Numeric): Prisma.Decimal {
  return toDecimal(a).minus(toDecimal(b));
}

export function mul(a: Numeric, b: Numeric): Prisma.Decimal {
  return toDecimal(a).times(toDecimal(b));
}

export function div(a: Numeric, b: Numeric): Prisma.Decimal {
  const d = toDecimal(b);
  if (d.isZero()) return new Prisma.Decimal(0);
  return toDecimal(a).dividedBy(d);
}

export function sum(values: Numeric[]): Prisma.Decimal {
  return add(...values);
}

/** Arredonda para 2 casas (dinheiro). */
export function money(v: Numeric): Prisma.Decimal {
  return toDecimal(v).toDecimalPlaces(2);
}

export function isZero(v: Numeric): boolean {
  return toDecimal(v).isZero();
}

export function gt(a: Numeric, b: Numeric): boolean {
  return toDecimal(a).greaterThan(toDecimal(b));
}

export function gte(a: Numeric, b: Numeric): boolean {
  return toDecimal(a).greaterThanOrEqualTo(toDecimal(b));
}

/** Converte para number apenas na borda (ex.: gráficos). Não usar em cálculos. */
export function toNumber(v: Numeric): number {
  return toDecimal(v).toNumber();
}
