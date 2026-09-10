import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  FOLGA_DO_LIMITE_SUGERIDO,
  VARIACAO_MAXIMA_ACEITA,
  VARIACAO_MINIMA_ACEITA,
  avaliarAlerta,
  frase,
  limitesSugeridos,
} from "@/lib/cotacoes/alerta";

const dec = (v: string) => new Prisma.Decimal(v);
const config = (p: Partial<Parameters<typeof avaliarAlerta>[0]> = {}) => ({
  variacaoMinima: 10,
  precoTeto: null,
  precoPiso: null,
  ...p,
});

describe("avaliarAlerta — variação", () => {
  it("dispara na alta e na baixa a partir do limiar", () => {
    expect(avaliarAlerta(config(), { refPrice: 11, anterior: 10 }).motivos).toEqual(["alta"]);
    expect(avaliarAlerta(config(), { refPrice: 9, anterior: 10 }).motivos).toEqual(["baixa"]);
  });

  it("não dispara abaixo do limiar", () => {
    expect(avaliarAlerta(config(), { refPrice: 10.9, anterior: 10 }).motivos).toEqual([]);
  });

  it("o limiar é do ALERTA, não fixo no código", () => {
    // Cebola oscila muito mais que batata. Um limiar único faria a cebola
    // avisar quase todo dia — e alarme que toca todo dia é desligado.
    const frouxo = avaliarAlerta(config({ variacaoMinima: 30 }), { refPrice: 12, anterior: 10 });
    const apertado = avaliarAlerta(config({ variacaoMinima: 5 }), { refPrice: 12, anterior: 10 });
    expect(frouxo.motivos).toEqual([]);
    expect(apertado.motivos).toEqual(["alta"]);
  });

  it("um limiar abaixo do piso é elevado ao piso, não obedecido", () => {
    /*
      0,1% em R$ 5,00 é meio centavo — o arredondamento do próprio boletim.
      Obedecer a esse número entregaria um alerta que toca todo dia por ruído,
      que é o mesmo defeito que `LIMIAR_DE_ESTABILIDADE` evita na seta do cartão.
    */
    const r = avaliarAlerta(config({ variacaoMinima: 0.1 }), { refPrice: 5.01, anterior: 5 });
    expect(r.motivos).toEqual([]);
    expect(VARIACAO_MINIMA_ACEITA).toBe(0.5);
    expect(VARIACAO_MAXIMA_ACEITA).toBeGreaterThan(100);
  });

  it("item que estreou no boletim não dispara variação", () => {
    // Sem anterior não há movimento medido. Tratar como 0% ou como alta seria
    // inventar notícia sobre o primeiro dia de um produto.
    const r = avaliarAlerta(config(), { refPrice: 10, anterior: null });
    expect(r.motivos).toEqual([]);
    expect(r.variacao).toBeNull();
  });

  it("aceita Decimal, que é como o preço chega do banco", () => {
    const r = avaliarAlerta(config({ variacaoMinima: dec("10.00") }), {
      refPrice: dec("5.88"),
      anterior: dec("5.00"),
    });
    expect(r.motivos).toEqual(["alta"]);
    expect(r.variacao).toBeCloseTo(17.6);
  });
});

describe("avaliarAlerta — teto e piso", () => {
  it("teto dispara mesmo sem variação relevante", () => {
    /*
      A razão de o teto existir separado do limiar: um produto que sobe 2% por
      semana nunca cruza um limiar de 10%, e em um mês passou do teto. É a
      subida lenta que ninguém percebe boletim a boletim.
    */
    const r = avaliarAlerta(config({ precoTeto: 10 }), { refPrice: 10.1, anterior: 10 });
    expect(r.motivos).toEqual(["acima_do_teto"]);
  });

  it("piso dispara na queda até o valor marcado", () => {
    const r = avaliarAlerta(config({ precoPiso: 3 }), { refPrice: 3, anterior: 3.01 });
    expect(r.motivos).toEqual(["abaixo_do_piso"]);
  });

  it("acumula motivos: subiu MUITO e passou do teto são duas notícias", () => {
    const r = avaliarAlerta(config({ variacaoMinima: 10, precoTeto: 10 }), {
      refPrice: 12,
      anterior: 10,
    });
    expect(r.motivos).toEqual(["alta", "acima_do_teto"]);
  });

  it("teto e piso ausentes não disparam nada sozinhos", () => {
    expect(avaliarAlerta(config(), { refPrice: 999, anterior: 999 }).motivos).toEqual([]);
  });

  it("teto ou piso zerado/negativo é ignorado em vez de disparar sempre", () => {
    // Um piso de 0 casaria com nenhum preço, mas um teto de 0 dispararia em
    // TODO boletim — e um alerta que toca sempre é um alerta desligado.
    expect(avaliarAlerta(config({ precoTeto: 0 }), { refPrice: 5, anterior: 5 }).motivos).toEqual([]);
    expect(avaliarAlerta(config({ precoPiso: -1 }), { refPrice: 5, anterior: 5 }).motivos).toEqual([]);
  });

  it("sem preço atual não avalia nada", () => {
    const r = avaliarAlerta(config({ precoTeto: 1 }), { refPrice: null, anterior: 10 });
    expect(r.motivos).toEqual([]);
    expect(r.variacao).toBeNull();
  });
});

describe("limitesSugeridos", () => {
  it("propõe teto acima e piso abaixo da média", () => {
    // 15% de folga: R$ 10,00 de média → teto 11,50, piso 8,50.
    expect(limitesSugeridos(10)).toEqual({ teto: 11.5, piso: 8.5 });
  });

  it("arredonda para centavos, que é o que o campo aceita", () => {
    // 4,33 × 1,15 = 4,9795 → 4,98; × 0,85 = 3,6805 → 3,68.
    expect(limitesSugeridos(dec("4.33"))).toEqual({ teto: 4.98, piso: 3.68 });
  });

  it("aceita Decimal, que é como a média chega do banco", () => {
    expect(limitesSugeridos(dec("20.00"))).toEqual({ teto: 23, piso: 17 });
  });

  it("média ausente ou não positiva não vira sugestão", () => {
    /*
      Zero aqui seria pior que nada: um teto de R$ 0,00 é ignorado por
      `avaliarAlerta` (limite não positivo não dispara), então a tela ofereceria
      um botão que grava um alerta que nunca toca — sem nada explicando.
    */
    expect(limitesSugeridos(null)).toBeNull();
    expect(limitesSugeridos(undefined)).toBeNull();
    expect(limitesSugeridos(0)).toBeNull();
    expect(limitesSugeridos(-5)).toBeNull();
  });

  it("a folga é a constante exportada, não um número solto na tela", () => {
    // Se alguém mexer na folga, este teste diz onde a decisão mora.
    expect(FOLGA_DO_LIMITE_SUGERIDO).toBe(0.15);
    const m = 100;
    /*
      O arredondamento é conferido, não contornado: `100 * 1.15` em ponto
      flutuante é 114.99999999999999, e é por isso que a função arredonda. Sem o
      arredondamento, o campo do formulário receberia esse valor e o cliente
      veria "R$ 114,99999999999999" no teto do alerta.
    */
    expect(m * (1 + FOLGA_DO_LIMITE_SUGERIDO)).not.toBe(115);
    expect(limitesSugeridos(m)!.teto).toBe(115);
  });

  it("o piso sugerido é sempre MENOR que o teto — a regra que o Zod cobra", () => {
    // `salvarAlertaSchema` recusa piso >= teto. Uma sugestão que caísse nessa
    // regra faria o botão "Usar" produzir um formulário que não salva.
    for (const media of [0.07, 1, 4.33, 85, 9999.99]) {
      const l = limitesSugeridos(media)!;
      expect(l.piso).toBeLessThan(l.teto);
    }
  });
});

describe("frase do disparo", () => {
  it("diz o preço junto com o motivo", () => {
    // Sem o número, "Batata subiu 18%" obriga a abrir o app para saber se é em
    // cima de R$ 3,00 ou de R$ 30,00 — e quem vai ao CEASA às 4h não abre.
    expect(frase("Batata", ["alta"], 18.4, "R$ 4,33")).toBe("Batata subiu 18% (R$ 4,33)");
    expect(frase("Cebola", ["baixa"], -18.1, "R$ 3,48")).toBe("Cebola caiu 18% (R$ 3,48)");
  });

  it("teto e piso têm texto próprio, sem percentual inventado", () => {
    expect(frase("Tomate", ["acima_do_teto"], null, "R$ 9,00")).toBe(
      "Tomate passou do seu teto (R$ 9,00)",
    );
    expect(frase("Mamão", ["abaixo_do_piso"], null, "R$ 2,00")).toBe(
      "Mamão está abaixo do seu piso (R$ 2,00)",
    );
  });

  it("a variação vence o teto no texto: o movimento é a notícia", () => {
    expect(frase("Batata", ["alta", "acima_do_teto"], 22, "R$ 6,00")).toBe(
      "Batata subiu 22% (R$ 6,00)",
    );
  });
});
