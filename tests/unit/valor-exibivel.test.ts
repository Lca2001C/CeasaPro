import { describe, it, expect } from "vitest";
import { formatBRL, formatQty, valorExibivel } from "@/lib/format";

/**
 * `valorExibivel` conserta dois defeitos de layout que vêm do próprio
 * `Intl.NumberFormat`, e os dois só aparecem em espaço estreito — foi assim que
 * passaram: no desktop cabe, no celular estoura.
 *
 * Estes testes conferem PONTOS DE CÓDIGO, não a aparência. É de propósito: os
 * caracteres envolvidos são invisíveis no editor, e uma edição distraída que
 * troque o NBSP por um espaço comum não muda nada visível no código-fonte — mas
 * desfaz a correção. Aqui isso quebra.
 */

const NBSP = " ";
const MENOS = "−";
const HIFEN = "-";

const pontos = (s: string) =>
  [...s].map((c) => c.charCodeAt(0)).filter((c) => c > 127);

describe("o defeito que se está corrigindo", () => {
  it("o Intl separa 'R$' do número com NBSP, que proíbe quebra de linha", () => {
    // Este é o teste que documenta a CAUSA. Se um dia o Intl mudar e passar a
    // usar espaço comum, ele falha e avisa que a correção ficou desnecessária.
    expect(formatBRL(11000)).toContain(NBSP);
  });

  it("o Intl usa hífen-menos no negativo, que PERMITE quebra depois dele", () => {
    expect(formatBRL(-950).startsWith(HIFEN)).toBe(true);
  });
});

describe("valorExibivel", () => {
  it("troca o NBSP por espaço comum, criando ponto de quebra depois do 'R$'", () => {
    const r = valorExibivel(formatBRL(11000));
    expect(r).not.toContain(NBSP);
    expect(r).toBe("R$ 11.000,00");
    // A quebra possível fica ENTRE "R$" e o número: os dígitos nunca se separam.
    expect(r.split(" ")).toEqual(["R$", "11.000,00"]);
  });

  it("troca o hífen-menos pelo sinal de menos, que não deixa o sinal órfão", () => {
    const r = valorExibivel(formatBRL(-950));
    expect(r.startsWith(MENOS)).toBe(true);
    expect(r.startsWith(HIFEN)).toBe(false);
    expect(r).toBe(`${MENOS}R$ 950,00`);
  });

  it("mantém o sinal colado ao 'R$'", () => {
    // Se houvesse espaço aqui, o sinal voltaria a poder ficar sozinho na linha.
    const r = valorExibivel(formatBRL(-1234.56));
    expect(r.slice(0, 4)).toBe(`${MENOS}R$ `.slice(0, 4));
    expect(r.indexOf(" ")).toBe(3); // − R $ [espaço]
  });

  it("não mexe em texto sem esses caracteres", () => {
    expect(valorExibivel("42")).toBe("42");
    expect(valorExibivel("0 caixas")).toBe("0 caixas");
    expect(valorExibivel("")).toBe("");
  });

  it("troca só o sinal do INÍCIO, não hífens no meio", () => {
    // Datas e faixas usam hífen legitimamente.
    expect(valorExibivel("01-02-2026")).toBe("01-02-2026");
    expect(valorExibivel("10-20 caixas")).toBe("10-20 caixas");
  });

  it("é idempotente", () => {
    const uma = valorExibivel(formatBRL(-11000));
    expect(valorExibivel(uma)).toBe(uma);
  });

  it("serve para porcentagem negativa (a margem líquida do painel)", () => {
    // O caso da tela: "-633,33%" com o sinal quebrando para a linha de cima.
    const r = valorExibivel(`${formatQty(-633.33)}%`);
    expect(r).toBe(`${MENOS}633,33%`);
    expect(pontos(r)).toEqual([0x2212]);
  });

  it("não introduz caractere invisível nenhum", () => {
    // Um U+2060 (word joiner) ou U+00A0 sobrevivente sujaria o copiar-e-colar
    // do valor para uma planilha.
    const r = valorExibivel(formatBRL(-11000));
    expect(pontos(r)).toEqual([0x2212]);
  });
});

describe("formatBRL continua intacto", () => {
  it("exportação e e-mail não são afetados pela correção de layout", () => {
    // `formatBRL` é o que vai para Excel, PDF e e-mail. Trocar os caracteres lá
    // mudaria arquivo entregue ao cliente para resolver um problema de tela.
    expect(formatBRL(11000)).toBe(`R$${NBSP}11.000,00`);
    expect(formatBRL(-950)).toBe(`${HIFEN}R$${NBSP}950,00`);
  });
});
