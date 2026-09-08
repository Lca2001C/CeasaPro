import { describe, expect, it } from "vitest";
import { desenharHistorico, type PontoParaDesenho } from "@/lib/cotacoes/grafico";

const DIA = 86_400_000;
const ponto = (dias: number, ref: number, min: number | null = null, max: number | null = null): PontoParaDesenho => ({
  t: dias * DIA,
  ref,
  min,
  max,
});

/** O X de cada vértice de uma string de pontos SVG. */
const xs = (trilha: string) => trilha.split(" ").map((p) => Number(p.split(",")[0]));
/** O Y de cada vértice. */
const ys = (trilha: string) => trilha.split(" ").map((p) => Number(p.split(",")[1]));

describe("desenharHistorico", () => {
  it("não desenha com menos de dois pontos", () => {
    expect(desenharHistorico([], 100, 40)).toBeNull();
    expect(desenharHistorico([ponto(0, 5)], 100, 40)).toBeNull();
  });

  it("espaça o eixo X pelo TEMPO, não pela posição na lista", () => {
    /*
      O teste que justifica o módulo. A praça publicou no dia 0, no dia 1 e só
      voltou a publicar no dia 11 — cadência real de Juiz de Fora e Barbacena,
      que publicam 2 a 3 vezes por semana.

      Espaçando por índice, os três pontos cairiam em 0, 50 e 100: o intervalo de
      um dia e o de dez dias teriam a mesma largura, e uma queda arrastada por
      uma semana e meia seria desenhada como um tombo de um dia para o outro.
    */
    const d = desenharHistorico([ponto(0, 10), ponto(1, 10), ponto(11, 10)], 100, 40)!;
    expect(xs(d.linha)).toEqual([0, 100 / 11, 100].map((v) => Number(v.toFixed(1))));
    // E o que ele NÃO pode ser:
    expect(xs(d.linha)).not.toEqual([0, 50, 100]);
  });

  it("ordena por data antes de desenhar", () => {
    // Um ponto fora de ordem viraria um zigue-zague que atravessa o gráfico.
    const d = desenharHistorico([ponto(2, 10), ponto(0, 8), ponto(1, 9)], 100, 40)!;
    expect(xs(d.linha)).toEqual([0, 50, 100]);
  });

  it("deixa folga vertical: nenhum ponto encosta na borda", () => {
    const d = desenharHistorico([ponto(0, 5), ponto(1, 10)], 100, 40)!;
    for (const y of ys(d.linha)) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(40);
    }
    expect(d.pisoDoEixo).toBeLessThan(5);
    expect(d.tetoDoEixo).toBeGreaterThan(10);
  });

  it("série constante sai no meio da caixa, sem dividir por zero", () => {
    const d = desenharHistorico([ponto(0, 7), ponto(1, 7), ponto(2, 7)], 100, 40)!;
    expect(d.linha).not.toContain("NaN");
    for (const y of ys(d.linha)) expect(y).toBeCloseTo(20, 1);
  });

  it("a moldura vertical cobre a faixa do dia, não só a linha", () => {
    // Sem isto o polígono de mínimo/máximo vazaria para fora da caixa e o
    // navegador o cortaria pela metade.
    const d = desenharHistorico([ponto(0, 10, 2, 30), ponto(1, 11, 3, 28)], 100, 40)!;
    expect(d.pisoDoEixo).toBeLessThan(2);
    expect(d.tetoDoEixo).toBeGreaterThan(30);
    for (const y of ys(d.faixa)) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(40);
    }
  });

  it("fecha o polígono da faixa: máximos na ida, mínimos na volta", () => {
    const d = desenharHistorico([ponto(0, 10, 8, 12), ponto(1, 10, 9, 11)], 100, 40)!;
    const x = xs(d.faixa);
    expect(x).toEqual([0, 100, 100, 0]);
  });

  it("não desenha faixa quando a fonte não publica mínimo e máximo em TODOS os dias", () => {
    /*
      A série nacional da CONAB não traz faixa. Costurar um polígono só pelos
      dias que têm inventaria amplitude nos dias que não têm — o gráfico
      afirmaria uma variação intradiária que ninguém mediu.
    */
    const d = desenharHistorico([ponto(0, 10, 8, 12), ponto(1, 11)], 100, 40)!;
    expect(d.faixa).toBe("");
    expect(d.linha).not.toBe("");
  });

  it("descarta pontos não finitos em vez de produzir NaN no SVG", () => {
    // Um NaN no atributo `points` invalida a figura inteira e ela some sem erro.
    const d = desenharHistorico(
      [ponto(0, 10), { t: Number.NaN, ref: 5, min: null, max: null }, ponto(2, 12)],
      100,
      40,
    )!;
    expect(d.linha).not.toContain("NaN");
    expect(d.linha.split(" ")).toHaveLength(2);
  });
});
