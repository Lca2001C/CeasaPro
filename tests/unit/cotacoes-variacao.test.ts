import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  LIMIAR_DE_ESTABILIDADE,
  direcaoDaVariacao,
  rotuloDeVariacao,
  trilhaDoMinigrafico,
  variacaoPercentual,
} from "@/lib/cotacoes/variacao";

const dec = (v: string) => new Prisma.Decimal(v);

describe("variacaoPercentual", () => {
  it("calcula alta e baixa", () => {
    expect(variacaoPercentual(11, 10)).toBeCloseTo(10);
    expect(variacaoPercentual(9, 10)).toBeCloseTo(-10);
    expect(variacaoPercentual(10, 10)).toBe(0);
  });

  it("aceita Decimal do Prisma, que é como o preço chega do banco", () => {
    expect(variacaoPercentual(dec("5.88"), dec("5.00"))).toBeCloseTo(17.6);
  });

  it("devolve null sem preço anterior — 'não sei' não é 'não mudou'", () => {
    // Produto que estreou no boletim de hoje. Zero aqui faria a tela dizer
    // "estável" para um preço que ela está vendo pela primeira vez.
    expect(variacaoPercentual(10, null)).toBeNull();
    expect(variacaoPercentual(10, undefined)).toBeNull();
    expect(variacaoPercentual(null, 10)).toBeNull();
  });

  it("devolve null quando a base é zero ou negativa, em vez de Infinity", () => {
    expect(variacaoPercentual(10, 0)).toBeNull();
    expect(variacaoPercentual(10, dec("0"))).toBeNull();
    expect(variacaoPercentual(10, -5)).toBeNull();
  });

  it("devolve null para valor não finito", () => {
    expect(variacaoPercentual(Number.NaN, 10)).toBeNull();
    expect(variacaoPercentual(10, Number.NaN)).toBeNull();
  });
});

describe("direcaoDaVariacao", () => {
  it("trata ruído de centavos como estável", () => {
    // R$ 0,02 em R$ 5,00 = 0,4%. Ninguém muda o preço do balcão por isso.
    const ruido = variacaoPercentual(dec("5.02"), dec("5.00"))!;
    expect(ruido).toBeLessThan(LIMIAR_DE_ESTABILIDADE);
    expect(direcaoDaVariacao(ruido)).toBe("estavel");
  });

  it("marca movimento a partir do limiar", () => {
    expect(direcaoDaVariacao(LIMIAR_DE_ESTABILIDADE)).toBe("alta");
    expect(direcaoDaVariacao(-LIMIAR_DE_ESTABILIDADE)).toBe("baixa");
    expect(direcaoDaVariacao(18)).toBe("alta");
  });

  it("sem variação não tem direção", () => {
    expect(direcaoDaVariacao(null)).toBeNull();
  });
});

describe("rotuloDeVariacao", () => {
  it("formata com sinal e vírgula decimal", () => {
    expect(rotuloDeVariacao(3.24)).toBe("+3,2%");
    expect(rotuloDeVariacao(18)).toBe("+18,0%");
  });

  it("usa o sinal de menos tipográfico, que não quebra linha", () => {
    const r = rotuloDeVariacao(-1.5)!;
    expect(r).toBe("−1,5%");
    // Um hífen comum permitiria a quebra que deixa o sinal órfão numa linha —
    // o mesmo defeito que `valorExibivel` corrige no valor em reais.
    expect(r.startsWith("-")).toBe(false);
  });

  it("mostra 0% cravado dentro do limiar, não o número arredondado", () => {
    // Sem isto a tela mostraria "+0,4%" arredondado para "+0,0%" ao lado de uma
    // seta de alta, e pareceria quebrada.
    expect(rotuloDeVariacao(0.4)).toBe("0%");
    expect(rotuloDeVariacao(-0.4)).toBe("0%");
    expect(rotuloDeVariacao(0)).toBe("0%");
  });

  it("sem variação não tem rótulo", () => {
    expect(rotuloDeVariacao(null)).toBeNull();
  });
});

describe("trilhaDoMinigrafico", () => {
  it("não desenha com menos de dois pontos — um ponto não é tendência", () => {
    expect(trilhaDoMinigrafico([], 60, 20)).toBe("");
    expect(trilhaDoMinigrafico([5], 60, 20)).toBe("");
  });

  it("mapeia o menor no chão e o maior no teto", () => {
    const t = trilhaDoMinigrafico([1, 2, 3], 60, 20);
    expect(t).toBe("0.0,20.0 30.0,10.0 60.0,0.0");
  });

  it("série constante desenha no meio, não encostada na base", () => {
    // Encostar no chão pareceria queda a zero para um preço que não mexeu.
    expect(trilhaDoMinigrafico([7, 7, 7], 60, 20)).toBe("0.0,10.0 30.0,10.0 60.0,10.0");
  });

  it("ignora valores não finitos em vez de produzir NaN no SVG", () => {
    // Um NaN no atributo `points` invalida a polyline INTEIRA: o navegador não
    // desenha nada e o cartão fica com um buraco sem explicação.
    const t = trilhaDoMinigrafico([1, Number.NaN, 3], 60, 20);
    expect(t).not.toContain("NaN");
    expect(t).toBe("0.0,20.0 60.0,0.0");
  });
});
