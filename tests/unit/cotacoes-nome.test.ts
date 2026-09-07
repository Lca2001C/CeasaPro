import { describe, it, expect } from "vitest";
import { normalizarNome, slugProduto, sugerirVinculos } from "@/lib/cotacoes/nome";

/**
 * A normalização existe para dar IDENTIDADE ao produto do boletim, e para
 * ordenar sugestões. Ela não decide vínculo nenhum — o teste do fim deste
 * arquivo é o que trava isso.
 */
describe("normalizarNome", () => {
  it("ignora caixa, acento e pontuação", () => {
    expect(normalizarNome("Tomate")).toBe("tomate");
    expect(normalizarNome("TOMATE")).toBe("tomate");
    expect(normalizarNome("Abóbora")).toBe("abobora");
    expect(normalizarNome("Alho-poró")).toBe("alho poro");
    expect(normalizarNome("Batata (lavada)")).toBe("batata lavada");
  });

  it("colapsa espaço, que é o que o boletim mais varia", () => {
    expect(normalizarNome("  TOMATE   SALADA  ")).toBe("tomate salada");
    expect(normalizarNome("TOMATE\tSALADA")).toBe("tomate salada");
  });

  it("as duas grafias do mesmo produto chegam ao mesmo texto", () => {
    expect(normalizarNome("Tomate  Salada (LONGA-VIDA)")).toBe(
      normalizarNome("TOMATE SALADA LONGA VIDA"),
    );
  });

  it("preserva número, que distingue produto de verdade", () => {
    // "Banana Prata Tipo 1" e "Tipo 2" são cotações diferentes.
    expect(normalizarNome("Banana Prata Tipo 1")).toBe("banana prata tipo 1");
  });

  it("entrada vazia ou só pontuação não quebra", () => {
    expect(normalizarNome("")).toBe("");
    expect(normalizarNome("   ")).toBe("");
    expect(normalizarNome("---")).toBe("");
  });
});

describe("slugProduto", () => {
  it("é estável entre grafias — é o que impede o catálogo de duplicar por dia", () => {
    expect(slugProduto("TOMATE  SALADA")).toBe("tomate-salada");
    expect(slugProduto("Tomate Salada")).toBe(slugProduto("TOMATE   SALADA"));
  });
});

describe("sugerirVinculos", () => {
  const doBoletim = [
    { nome: "TOMATE SALADA LONGA VIDA" },
    { nome: "TOMATE CEREJA" },
    { nome: "TOMATE ITALIANO" },
    { nome: "BATATA LISA ESPECIAL" },
    { nome: "ALFACE CRESPA" },
  ];
  const sugerir = (q: string, limite?: number) =>
    sugerirVinculos(q, doBoletim, (c) => c.nome, limite);

  /**
   * ESTE é o teste que guarda a decisão de projeto do módulo.
   *
   * "Tomate" é ambíguo entre três produtos de preços diferentes. A função tem de
   * DEVOLVER OS TRÊS e deixar a escolha para a pessoa. No dia em que alguém
   * "melhorar" isso para devolver o melhor palpite, o cliente passa a ver o
   * preço do tomate cereja onde queria o do salada — e nada avisa.
   */
  it("nome ambíguo devolve TODOS os candidatos, não um palpite", () => {
    const r = sugerir("Tomate");
    expect(r.length).toBeGreaterThanOrEqual(3);
    const nomes = r.map((x) => x.item.nome);
    expect(nomes).toContain("TOMATE SALADA LONGA VIDA");
    expect(nomes).toContain("TOMATE CEREJA");
    expect(nomes).toContain("TOMATE ITALIANO");
  });

  it("nenhum candidato ambíguo recebe escore de certeza", () => {
    // Escore 1 é reservado para igualdade exata. Se um prefixo chegasse a 1, a
    // tela poderia razoavelmente aplicá-lo sozinho.
    for (const c of sugerir("Tomate")) {
      expect(c.escore).toBeLessThan(1);
    }
  });

  it("igualdade exata (normalizada) vem em primeiro, com escore 1", () => {
    const r = sugerir("alface crespa");
    expect(r[0]!.item.nome).toBe("ALFACE CRESPA");
    expect(r[0]!.escore).toBe(1);
  });

  it("prefixo vence sobreposição parcial", () => {
    const r = sugerir("Batata");
    expect(r[0]!.item.nome).toBe("BATATA LISA ESPECIAL");
  });

  it("não inventa candidato para nome sem nada a ver", () => {
    expect(sugerir("Parafuso")).toEqual([]);
  });

  it("nome vazio não devolve a lista inteira", () => {
    expect(sugerir("")).toEqual([]);
    expect(sugerir("   ")).toEqual([]);
  });

  it("respeita o limite da tela", () => {
    expect(sugerir("Tomate", 2)).toHaveLength(2);
  });

  it("ordena do mais provável para o menos", () => {
    const r = sugerir("Tomate Cereja");
    expect(r[0]!.item.nome).toBe("TOMATE CEREJA");
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1]!.escore).toBeGreaterThanOrEqual(r[i]!.escore);
    }
  });
});
