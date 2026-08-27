import { describe, it, expect } from "vitest";
import {
  ESTOQUE_BAIXO,
  nivelEstoque,
  passaDoEstoque,
  saldoApos,
} from "@/lib/estoque/nivel";

/**
 * A regra de "acabando" vale nas DUAS telas — lista de estoque e frente de
 * caixa. Se divergirem, o Estoque avisa e o PDV não (ou o contrário), e o
 * operador deixa de confiar no aviso.
 */
describe("nivelEstoque", () => {
  it("saldo confortável é ok", () => {
    expect(nivelEstoque(25)).toBe("ok");
    expect(nivelEstoque(ESTOQUE_BAIXO)).toBe("ok"); // no limite ainda está ok
  });

  it("abaixo do limite é acabando", () => {
    expect(nivelEstoque(ESTOQUE_BAIXO - 1)).toBe("acabando");
    expect(nivelEstoque(3)).toBe("acabando");
    expect(nivelEstoque(0.5)).toBe("acabando");
  });

  it("zero é zerado", () => {
    expect(nivelEstoque(0)).toBe("zerado");
  });

  it("saldo NEGATIVO conta como zerado, não como estoque", () => {
    // Acontece com ajuste manual ou movimento fora de ordem. Mostrar
    // "-2 caixas" como se desse para vender é pior que mostrar "sem estoque".
    expect(nivelEstoque(-2)).toBe("zerado");
  });

  it("aceita string e Decimal, como vem do banco", () => {
    expect(nivelEstoque("25")).toBe("ok");
    expect(nivelEstoque("2.5")).toBe("acabando");
    expect(nivelEstoque("0")).toBe("zerado");
  });
});

describe("passaDoEstoque", () => {
  it("acusa venda maior que o saldo", () => {
    expect(passaDoEstoque(3, 5)).toBe(true);
  });

  it("vender exatamente o que tem é permitido", () => {
    expect(passaDoEstoque(5, 5)).toBe(false);
  });

  it("vender menos que o saldo é permitido", () => {
    expect(passaDoEstoque(25, 2)).toBe(false);
  });

  it("qualquer venda passa quando o saldo é zero", () => {
    expect(passaDoEstoque(0, 1)).toBe(true);
  });

  it("não erra por ponto flutuante em quantidade fracionada", () => {
    // 0.1 + 0.2 > 0.3 seria `true` em float puro — e o PDV acusaria falta de
    // estoque numa venda que cabe.
    expect(passaDoEstoque("0.3", 0.1 + 0.2)).toBe(false);
  });
});

describe("saldoApos", () => {
  it("calcula o que sobra depois da venda", () => {
    expect(saldoApos(25, 2).toString()).toBe("23");
  });

  it("mostra o negativo quando a venda passa do saldo — é o aviso", () => {
    expect(Number(saldoApos(3, 5))).toBe(-2);
  });

  it("mantém precisão decimal", () => {
    expect(saldoApos("10.5", "0.25").toString()).toBe("10.25");
  });
});
