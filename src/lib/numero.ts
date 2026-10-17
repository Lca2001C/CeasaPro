/**
 * Conversão de valor para `number` SEM o runtime do Prisma.
 *
 * `money.ts` usa `Prisma.Decimal` como valor (não só tipo), e todo componente de
 * cliente que importava `format.ts` ou `estoque/nivel.ts` levava junto o
 * runtime do Prisma e o Decimal para o navegador — em 18 telas. Exibir um
 * número e comparar quantidades de 3 casas não precisa de nada disso.
 *
 * Aceita o que chega das telas: número, texto do banco ("12.500") ou um Decimal
 * (qualquer objeto com `toString()` — o tipo é estrutural de propósito).
 */
export type Numerico = number | string | { toString(): string };

export function paraNumero(v: Numerico | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Como `paraNumero`, mas devolve `NaN` para o ilegível em vez de 0 — para quem
 * precisa distinguir "não sei" de "zero" (variação, alerta de preço).
 */
export function paraNumeroCru(v: Numerico): number {
  return typeof v === "number" ? v : Number(String(v));
}
