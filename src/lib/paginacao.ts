/**
 * Número de página vindo da URL, sempre um inteiro utilizável.
 *
 * `Math.max(1, Number(sp.pagina) || 1)` parecia suficiente e não era:
 *
 *  - `?pagina=1e400` → `Infinity` → `skip: Infinity` → o Prisma estoura e a
 *    tela responde 500;
 *  - `?pagina=1.5` → `skip` não inteiro → 500;
 *  - `?pagina=100000000` executava a consulta com OFFSET gigante ANTES de
 *    chegar ao redirecionamento corretivo que a própria tela já tinha.
 *
 * Não é vazamento, mas é 500 e varredura de tabela a partir de uma URL editada
 * à mão — e o teto evita as duas coisas antes de tocar o banco.
 */
export const PAGINA_MAXIMA = 100_000;

export function paginaDaUrl(bruto: string | undefined): number {
  const n = Number(bruto);
  if (!Number.isFinite(n)) return 1;
  return Math.min(PAGINA_MAXIMA, Math.max(1, Math.floor(n)));
}
