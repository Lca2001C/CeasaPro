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

/**
 * A página rola de lado?
 *
 * Complementa `vazamentos`, e a diferença importa: um cartão pode estar
 * perfeitamente contido e, ainda assim, a PÁGINA ficar mais larga que a tela —
 * basta um item flex sem `min-w-0` se recusando a encolher. O sintoma é a coluna
 * direita dos cartões cortada na borda do celular, que é o que se vê na tela sem
 * que nenhum cartão esteja "vazando".
 *
 * Devolve os pixels de excesso (0 = certo).
 */
export async function estouroHorizontalDaPagina(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  );
}

export async function vazamentos(page: Page): Promise<Vazamento[]> {
  return page.evaluate(() => {
    // 1px de tolerância: arredondamento de subpixel do próprio navegador.
    const TOLERANCIA = 1;
    const achados: { caixa: string; conteudo: string; excessoPx: number }[] = [];
    const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

    /**
     * O elemento está dentro de algo que rola de lado?
     *
     * Uma tabela mais larga que o cartão, dentro de um container
     * `overflow-x-auto`, é decisão de layout e não vazamento: quem lê arrasta a
     * tabela e a página fica quieta. Pular só o container — o que este helper
     * fazia — não bastava, porque a `<table>` dentro dele *é* mais larga que o
     * cartão, e era ela (com cabeçalho e todas as células) que entrava na lista.
     * O detalhe da venda aparecia com 25px de "vazamento" sem ter defeito algum.
     */
    const dentroDeAlgoQueRola = (el: Element, limite: Element) => {
      for (let no: Element | null = el; no; no = no.parentElement) {
        const ox = getComputedStyle(no).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
        if (no === limite) break;
      }
      return false;
    };

    // `.bg-card` é a assinatura do componente `Card` — a "caixa" do requisito.
    // Só `main`: a barra lateral também usa `bg-card` de fundo, e não é cartão.
    for (const caixa of Array.from(document.querySelectorAll("main .bg-card"))) {
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
        if (dentroDeAlgoQueRola(filho, caixa)) continue;

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
