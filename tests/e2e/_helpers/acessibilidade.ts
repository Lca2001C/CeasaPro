import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * A varredura de acessibilidade, compartilhada pelos specs.
 *
 * O axe roda DENTRO da página, na árvore já montada e estilizada — é a
 * diferença que importa contra o lint: o `eslint-plugin-jsx-a11y` olha um
 * arquivo JSX de cada vez e não segue composição, então não enxerga o par
 * rótulo/campo montado por dois componentes diferentes, nem contraste, nem
 * ordem de títulos. As duas defesas cobrem coisas distintas e nenhuma substitui
 * a outra.
 *
 * Este arquivo não termina em `.spec.ts`, então o Playwright não o executa como
 * teste (ver `testMatch` em `playwright.config.ts`).
 */

/** Gravidades que reprovam. `minor`/`moderate` viram relatório, não falha. */
const REPROVA = new Set(["serious", "critical"]);

export interface Violacao {
  regra: string;
  impacto: string;
  descricao: string;
  ajuda: string;
  alvos: string[];
}

/**
 * Roda o axe na página e devolve as violações já achatadas.
 *
 * `withTags` limita às regras que correspondem a um critério objetivo da WCAG
 * 2.1 AA e às melhores práticas — sem isso entram regras experimentais, que
 * mudam de resposta entre versões do axe e transformam a suíte em ruído.
 */
export async function varrer(page: Page, opcoes?: { ignorar?: string[] }): Promise<Violacao[]> {
  let scanner = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "best-practice",
  ]);

  if (opcoes?.ignorar?.length) scanner = scanner.disableRules(opcoes.ignorar);

  const resultado = await scanner.analyze();

  return resultado.violations.map((v) => ({
    regra: v.id,
    impacto: v.impact ?? "desconhecido",
    descricao: v.help,
    ajuda: v.helpUrl,
    alvos: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
}

/** Só o que reprova: `serious` e `critical`. */
export async function varrerGraves(
  page: Page,
  opcoes?: { ignorar?: string[] },
): Promise<Violacao[]> {
  return (await varrer(page, opcoes)).filter((v) => REPROVA.has(v.impacto));
}

/**
 * Formata as violações para a mensagem de falha.
 *
 * O relatório cru do axe é grande demais para caber numa asserção legível, e a
 * pessoa que vê o CI vermelho precisa saber o QUE consertar sem abrir um
 * artefato. Aqui sai uma linha por violação com a regra, onde ela está e o
 * link da documentação.
 */
export function descrever(violacoes: Violacao[]): string {
  if (violacoes.length === 0) return "nenhuma";
  return violacoes
    .map((v) => `  [${v.impacto}] ${v.regra}: ${v.descricao}\n    em: ${v.alvos.join(" | ")}\n    ${v.ajuda}`)
    .join("\n");
}
