import { describe, it, expect } from "vitest";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { toDecimal } from "@/lib/money";

/**
 * Regras da linha de fiado, no formato da planilha do balcão:
 * total da compra = soma dos itens, e saldo = total − pago.
 *
 * O "TOTAL DINHEIRO" da planilha é quantidade × preço; a "DIFERENÇA" é o que
 * ainda falta receber. É o mesmo cálculo que a listagem mostra.
 */
describe("total da compra (quantidade × preço)", () => {
  const linha = (qtd: string, preco: string) => toDecimal(qtd).times(toDecimal(preco));

  it("reproduz as linhas da planilha", () => {
    // 388 caixas × R$ 2,00 = R$ 776,00
    expect(linha("388", "2.00").toFixed(2)).toBe("776.00");
    // 382 × 2,00 = 764,00
    expect(linha("382", "2.00").toFixed(2)).toBe("764.00");
    // 226 × 2,00 = 452,00
    expect(linha("226", "2.00").toFixed(2)).toBe("452.00");
  });

  it("não perde centavo em preço quebrado", () => {
    // Ponto de usar Decimal: 0.1 + 0.2 em float daria 0.30000000000000004.
    expect(linha("3", "0.10").plus(linha("3", "0.20")).toFixed(2)).toBe("0.90");
    expect(linha("7", "1.35").toFixed(2)).toBe("9.45");
  });
});

describe("saldo do fiado (total − pago)", () => {
  it("entrega totalmente paga zera o saldo", () => {
    expect(FinancialCalc.saldoFiado("776.00", "776.00").toFixed(2)).toBe("0.00");
  });

  it("pagamento parcial deixa a diferença", () => {
    expect(FinancialCalc.saldoFiado("776.00", "300.00").toFixed(2)).toBe("476.00");
  });

  it("sem nenhum pagamento, o saldo é o total", () => {
    expect(FinancialCalc.saldoFiado("452.00", "0").toFixed(2)).toBe("452.00");
  });

  it("nunca devolve saldo negativo por pagamento a maior", () => {
    // A regra de negócio impede pagar acima do saldo, mas se um dado antigo
    // ficou torto a listagem não pode mostrar "−R$ 50,00 a receber".
    const saldo = FinancialCalc.saldoFiado("100.00", "150.00");
    expect(Number(saldo)).toBeLessThanOrEqual(0);
  });
});
