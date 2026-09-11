import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Contraste de cor, calculado a partir dos tokens reais.
 *
 * Esta auditoria encontrou dois tokens reprovando WCAG AA em produção, e
 * nenhum teste podia tê-los apanhado: contraste não aparece em teste de
 * unidade (não há cor), nem em teste de componente (o jsdom não pinta), e o
 * axe no Playwright só acusa o par que estiver NA TELA naquele momento — se
 * nenhum spec abrir a tela com o selo vencido, ninguém vê.
 *
 * Aqui a conta é feita sobre a fonte da verdade (`globals.css`) e sobre os
 * pares que o app de fato compõe, incluindo os que só existem quando duas
 * transparências se sobrepõem. É o único lugar onde isso é verificável sem
 * depender de alguém ter aberto a tela certa.
 *
 * O que foi corrigido a partir daqui:
 *  - `--warning` era `35 92% 45%`: 2,86:1 como texto E 2,86:1 como fundo —
 *    reprovando nos dois sentidos, numa cor cujo único papel é avisar;
 *  - `--destructive` era `0 72% 48%`: o selo `bg-destructive/10` dava 4,46:1,
 *    reprovando por uma casa decimal no selo de conta VENCIDA.
 */

const css = readFileSync("src/app/globals.css", "utf8");

/**
 * O conteúdo do bloco `:root`, e só dele.
 *
 * Recortar por `indexOf(".dark")` não funciona: a linha 3 declara
 * `@custom-variant dark (&:where(.dark, .dark *))`, que vem ANTES do `:root` —
 * o recorte saía vazio e os onze casos falhavam juntos com "token não
 * encontrado", que é uma mensagem que manda procurar no lugar errado.
 */
const BLOCO_RAIZ = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

/** Lê um token do bloco `:root` — a fonte da verdade, não uma cópia. */
function token(nome: string): [number, number, number] {
  // Só o `:root`; o bloco `.dark` redefine parte dos mesmos nomes.
  const m = new RegExp(`--${nome}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(BLOCO_RAIZ);
  if (!m) throw new Error(`token --${nome} não encontrado em :root`);
  return hslParaRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

function hslParaRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as [number, number, number];
}

/** Luminância relativa da WCAG 2.x. */
function luminancia([r, g, b]: [number, number, number]) {
  const canal = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function razao(a: [number, number, number], b: [number, number, number]) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/**
 * Compõe uma cor com transparência sobre um fundo.
 *
 * Necessário porque o app usa muito `bg-destructive/10` e `bg-success/15`: a
 * cor que o olho recebe não é nenhum token, é a mistura — e é sobre a mistura
 * que o contraste tem de ser medido.
 */
function sobre(
  frente: [number, number, number],
  alfa: number,
  fundo: [number, number, number],
): [number, number, number] {
  return frente.map((v, i) => Math.round(v * alfa + fundo[i]! * (1 - alfa))) as [
    number,
    number,
    number,
  ];
}

const BRANCO: [number, number, number] = [255, 255, 255];
/** Piso da WCAG AA para texto normal. */
const AA_TEXTO = 4.5;

describe("os tokens de aviso, que existem para serem lidos", () => {
  it("text-warning sobre o fundo do cartão", () => {
    /*
      Era 2,86:1. O pior caso é o "N a devolver" de caixas plásticas na tela de
      fiado: `text-xs`, e o único lugar onde o número pendente aparece. Caixa
      plástica é ativo do comerciante; número que ele não lê é prejuízo que ele
      não cobra.
    */
    expect(razao(token("warning"), BRANCO)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it("branco sobre bg-warning, que é o selo", () => {
    // O mesmo token nos dois papéis. Um laranja no meio da escala não contrasta
    // com NADA — nem com o branco por cima, nem com o branco por baixo.
    expect(razao(BRANCO, token("warning"))).toBeGreaterThanOrEqual(AA_TEXTO);
  });
});

describe("o vermelho, no selo e no botão", () => {
  it("text-destructive sobre bg-destructive/10 — o selo de VENCIDA", () => {
    // Reprovava por uma casa decimal (4,46:1). O selo diz que a conta venceu;
    // é a informação mais acionável da tela de fiado.
    const d = token("destructive");
    expect(razao(d, sobre(d, 0.1, BRANCO))).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it("branco sobre o botão destrutivo", () => {
    expect(razao(BRANCO, token("destructive"))).toBeGreaterThanOrEqual(AA_TEXTO);
  });
});

describe("o resto da paleta continua passando", () => {
  /*
    Estes já passavam. Estão aqui para que escurecer ou clarear um token no
    futuro não conserte um par e quebre outro em silêncio — que é o risco real
    de mexer em cor por token compartilhado.
  */
  const pares: Array<[string, () => number]> = [
    ["text-foreground sobre o fundo", () => razao(token("foreground"), token("background"))],
    ["text-muted-foreground sobre o fundo", () => razao(token("muted-foreground"), BRANCO)],
    ["text-primary sobre o fundo", () => razao(token("primary"), BRANCO)],
    ["branco sobre primary (botão)", () => razao(BRANCO, token("primary"))],
    ["text-success sobre o fundo", () => razao(token("success"), BRANCO)],
    [
      "accent-foreground sobre accent",
      () => razao(token("accent-foreground"), token("accent")),
    ],
  ];

  for (const [nome, calcular] of pares) {
    it(nome, () => expect(calcular()).toBeGreaterThanOrEqual(AA_TEXTO));
  }
});

describe("dívida registrada, com número", () => {
  it("a borda dos campos fica abaixo de 3:1, e isso está documentado", () => {
    /*
      `--border`/`--input` é `240 6% 89%`, que dá 1,30:1 contra o branco. A WCAG
      1.4.11 pede 3:1 para o contorno que identifica um componente, e num
      celular barato sob luz de galpão a borda clara some mesmo.

      NÃO foi corrigido, de propósito, e o motivo é honesto: chegar a 3:1 exige
      um cinza médio (perto de 55% de luminosidade) em toda borda do app — é
      mudança de aparência do produto inteiro, não conserto de defeito, e a
      decisão é de quem é dono da marca. O axe também não acusa, porque a borda
      não é o único meio de identificar os campos (há rótulo, fundo e foco).

      Este teste trava o número atual. Se alguém CLAREAR ainda mais a borda, ele
      falha e a conversa volta à mesa; se alguém corrigir de vez, ele falha
      pedindo para promover a dívida a garantia.
    */
    const atual = razao(token("border"), BRANCO);
    expect(atual).toBeLessThan(3);
    expect(atual, "a borda não pode ficar ainda mais fraca").toBeGreaterThanOrEqual(1.3);
  });
});
