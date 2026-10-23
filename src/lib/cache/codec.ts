import { Prisma } from "@prisma/client";

/**
 * JSON que devolve `Decimal` como `Decimal` e `Date` como `Date`.
 *
 * O `JSON.stringify` puro chama `toJSON` antes de o replacer ver o valor: o
 * `Decimal` virava string e a `Date` virava ISO, e o leitor do cache recebia
 * outro tipo — dinheiro como texto, que `plus`/`minus` não aceitam, e data que
 * `formatDate` formata errado. Por isso o replacer lê o valor ORIGINAL em
 * `this[chave]` e o etiqueta.
 */
function replacer(this: Record<string, unknown>, chave: string, valor: unknown): unknown {
  const original = this[chave];
  if (Prisma.Decimal.isDecimal(original)) return { $d: (original as Prisma.Decimal).toString() };
  if (original instanceof Date) return { $t: original.toISOString() };
  if (typeof original === "bigint") return { $b: original.toString() };
  return valor;
}

function reviver(_chave: string, valor: unknown): unknown {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    const v = valor as Partial<Record<"$d" | "$t" | "$b", unknown>>;
    const chaves = Object.keys(valor);
    if (chaves.length === 1) {
      if (typeof v.$d === "string") return new Prisma.Decimal(v.$d);
      if (typeof v.$t === "string") return new Date(v.$t);
      if (typeof v.$b === "string") return BigInt(v.$b);
    }
  }
  return valor;
}

export function serializar(valor: unknown): string {
  return JSON.stringify({ v: valor }, replacer);
}

export function desserializar<T>(texto: string): T {
  return (JSON.parse(texto, reviver) as { v: T }).v;
}
