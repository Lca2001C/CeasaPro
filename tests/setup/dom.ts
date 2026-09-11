import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

/**
 * O ambiente dos testes de componente.
 *
 * Até esta auditoria não existia nenhum: `jsdom` e `@testing-library/react` não
 * estavam instalados, então **nenhum teste de componente era possível**. A
 * consequência prática é que toda a lógica de apresentação — estado derivado,
 * formatação de moeda, o que aparece quando a lista está vazia, o erro que some
 * quando a causa é resolvida — só era exercitada por E2E, que é caro, lento e
 * roda contra um banco. Regra de apresentação errada só aparecia em produção.
 *
 * Este arquivo roda apenas no projeto `dom` do Vitest. O projeto `node` continua
 * com as três travas de segurança (banco, e-mail, HTTP) e em série, porque
 * compartilha o Postgres; o `dom` não fala com nada e roda em paralelo.
 */

/*
  Sem `globals: true`, a limpeza automática da testing-library não é registrada:
  ela depende do `afterEach` global existir no escopo. Sem isto, cada `render`
  empilha no mesmo `document.body` e uma consulta como `getByRole("button")`
  passa a achar o botão do teste ANTERIOR — o teste fica verde afirmando sobre a
  árvore errada, que é pior do que falhar.
*/
afterEach(() => {
  cleanup();
});

/**
 * O que o jsdom não implementa e o Radix exige.
 *
 * Diálogo, sheet, select e tabs (`@radix-ui/*`) medem o elemento para se
 * posicionar e capturam o ponteiro para arrastar. Nada disso existe no jsdom, e
 * a falha não é um aviso: é `TypeError: ... is not a function` no meio do
 * render, que faz o teste falhar por motivo que nada tem a ver com a regra
 * afirmada.
 *
 * São implementações mínimas de propósito — o suficiente para o componente
 * montar. Teste de componente afirma comportamento, não geometria; o que
 * depende de pixel de verdade fica na regressão visual do Playwright, onde há
 * um navegador que mede de fato.
 */
class ObservadorInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ObservadorInerte as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??=
  ObservadorInerte as unknown as typeof IntersectionObserver;

if (typeof window !== "undefined") {
  // `matchMedia` é consultado pelo tema, pelo sonner e por qualquer coisa que
  // pergunte se a tela é pequena. Responder "não casa" é o padrão certo: o
  // jsdom não tem viewport, e o comportamento responsivo é verificado no
  // Playwright, com viewport de verdade.
  window.matchMedia ??= ((consulta: string) => ({
    matches: false,
    media: consulta,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView ??= () => {};
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
}

/**
 * `toHaveAccessibleName` e afins vêm do jest-dom; este matcher é da casa.
 *
 * Existe porque a asserção que mais se repete nesta auditoria é "o campo em
 * erro está ligado à mensagem". Escrever isso à mão são quatro linhas por caso
 * (achar o `aria-describedby`, quebrar por espaço, achar cada id, juntar o
 * texto) — e quatro linhas repetidas quarenta vezes é onde o teste passa a
 * afirmar menos do que parece.
 */
expect.extend({
  /**
   * Confere que o campo está marcado como inválido E que a mensagem visível
   * está associada a ele por `aria-describedby`.
   *
   * As duas metades importam. `aria-invalid` sozinho anuncia "inválido" sem
   * dizer o motivo; a mensagem sozinha fica na tela sem o leitor de tela ligar
   * uma coisa à outra, e quem navega por teclado ouve o campo sem saber o que
   * ele tem de errado.
   */
  toEstarEmErroCom(campo: HTMLElement, textoEsperado: string | RegExp) {
    const invalido = campo.getAttribute("aria-invalid");
    if (invalido !== "true") {
      return {
        pass: false,
        message: () =>
          `esperava aria-invalid="true" no campo, veio ${JSON.stringify(invalido)}`,
      };
    }

    const ids = (campo.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    if (ids.length === 0) {
      return {
        pass: false,
        message: () =>
          "o campo está aria-invalid mas não aponta aria-describedby para nenhuma mensagem",
      };
    }

    const descricao = ids
      .map((id) => campo.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();

    const casa =
      typeof textoEsperado === "string"
        ? descricao.includes(textoEsperado)
        : textoEsperado.test(descricao);

    return {
      pass: casa,
      message: () =>
        casa
          ? `esperava que a descrição do campo NÃO fosse ${textoEsperado}`
          : `a descrição ligada ao campo é ${JSON.stringify(descricao)}, esperava ${textoEsperado}`,
    };
  },
});

/*
  A declaração acompanha `Assertion`, e não `Matchers`.

  As duas existem, e escolher errado não compila: `Matchers` é declarada em
  dois lugares com números diferentes de parâmetros de tipo, e aumentar a
  versão errada responde "All declarations of 'Matchers' must have identical
  type parameters" — no `next build`, não no `vitest`, que é o pior lugar para
  descobrir. `Assertion` é a mesma porta que o `@testing-library/jest-dom` usa.

  O `= any` no parâmetro não é escolha: para fundir com a interface existente,
  a assinatura tem de ser idêntica à dela.
*/
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> {
    toEstarEmErroCom(textoEsperado: string | RegExp): T;
  }
  interface AsymmetricMatchersContaining {
    toEstarEmErroCom(textoEsperado: string | RegExp): unknown;
  }
}
