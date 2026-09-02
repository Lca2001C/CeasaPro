import type { Page } from "@playwright/test";

/**
 * Mede, no navegador, se algum elemento passa da borda da caixa que o contém.
 *
 * Compartilhado entre os specs porque a exigência é a mesma em toda a aplicação:
 * nada escapa do cartão, com qualquer tamanho de valor.
 *
 * Mede em vez de conferir classes CSS de propósito. O defeito original — o
 * "R$ 11.000,00" cortado na borda do cartão — não quebra nenhuma asserção de
 * texto: o texto está no documento, só não está visível. Um teste que olhasse
 * classes passaria com o defeito presente.
 *
 * Este arquivo não termina em `.spec.ts`, então o Playwright não o executa como
 * teste (ver `testMatch` em `playwright.config.ts`).
 */

export interface Vazamento {
  /** Início do texto do cartão, para localizar qual é. */
  caixa: string;
  conteudo: string;
  excessoPx: number;
}

export async function vazamentos(page: Page): Promise<Vazamento[]> {
  return page.evaluate(() => {
    // 1px de tolerância: arredondamento de subpixel do próprio navegador.
    const TOLERANCIA = 1;
    const achados: { caixa: string; conteudo: string; excessoPx: number }[] = [];
    const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

    // `.bg-card` é a assinatura do componente `Card` — a "caixa" do requisito.
    for (const caixa of Array.from(document.querySelectorAll(".bg-card"))) {
      const r = caixa.getBoundingClientRect();
      if (r.width === 0) continue;

      // Jeito 1 de vazar: o conteúdo é mais largo que a caixa.
      if (caixa.scrollWidth > caixa.clientWidth + TOLERANCIA) {
        achados.push({
          caixa: texto(caixa).slice(0, 60),
          conteudo: "(conteúdo mais largo que a caixa)",
          excessoPx: Math.round(caixa.scrollWidth - caixa.clientWidth),
        });
      }

      // Jeito 2: um filho empurrado para fora (o clássico `shrink-0` sem
      // `min-w-0` no irmão).
      for (const filho of Array.from(caixa.querySelectorAll("*"))) {
        const f = filho.getBoundingClientRect();
        if (f.width === 0 && f.height === 0) continue;
        // Elemento com rolagem própria (tabela larga) é decisão de layout, não
        // vazamento: o que ele contém fica dentro dele.
        const estilo = getComputedStyle(filho);
        if (estilo.overflowX === "auto" || estilo.overflowX === "scroll") continue;

        const excesso = Math.max(f.right - r.right, r.left - f.left);
        if (excesso > TOLERANCIA) {
          achados.push({
            caixa: texto(caixa).slice(0, 60),
            conteudo: texto(filho).slice(0, 40),
            excessoPx: Math.round(excesso),
          });
        }
      }
    }
    return achados;
  });
}
