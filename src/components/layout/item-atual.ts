/**
 * Qual item do menu é a tela atual — UM só.
 *
 * Casar por prefixo item a item acendia dois ao mesmo tempo: em `/vendas/nova`,
 * tanto "Vender (PDV)" (`/vendas/nova`) quanto "Vendas" (`/vendas`) casam, e os
 * dois recebiam fundo de ativo e `aria-current="page"` — o leitor de tela
 * anunciava duas páginas atuais. Vence o href mais longo que casa: é o mais
 * específico.
 */
export function hrefAtual(hrefs: readonly string[], pathname: string): string | null {
  let melhor: string | null = null;
  for (const href of hrefs) {
    const casa = pathname === href || pathname.startsWith(href + "/");
    if (casa && (melhor === null || href.length > melhor.length)) melhor = href;
  }
  return melhor;
}
