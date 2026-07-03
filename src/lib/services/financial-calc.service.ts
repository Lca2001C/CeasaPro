import { Prisma } from "@prisma/client";
import { add, sub, mul, div, money, toDecimal, type Numeric } from "@/lib/money";

/**
 * FinancialCalcService — ÚNICA fonte das fórmulas financeiras (README §9).
 * Funções puras (sem I/O), fáceis de testar. Nenhuma regra financeira deve
 * existir fora deste módulo.
 *
 *   valor_total_compra = quantidade * preco_unitario + frete
 *   valor_total_venda  = quantidade * valor_unitario
 *   lucro_bruto        = total_vendido - custo_dos_produtos_vendidos
 *   lucro_liquido      = lucro_bruto - despesas
 *   margem_liquida     = (lucro_liquido / total_vendido) * 100
 */
export const FinancialCalc = {
  /** Total de uma compra: itens + frete. */
  valorTotalCompra(quantidade: Numeric, precoUnitario: Numeric, frete: Numeric = 0) {
    return money(add(mul(quantidade, precoUnitario), frete));
  },

  /** Custo real por unidade, com o frete rateado. Protege contra quantidade zero. */
  custoRealUnitario(quantidade: Numeric, precoUnitario: Numeric, frete: Numeric = 0) {
    const q = toDecimal(quantidade);
    if (q.isZero()) return toDecimal(precoUnitario).toDecimalPlaces(4);
    const total = add(mul(quantidade, precoUnitario), frete);
    return div(total, q).toDecimalPlaces(4);
  },

  /**
   * Rateia um frete total entre itens, proporcional ao valor de cada linha.
   * Retorna o frete atribuído a cada item, na mesma ordem.
   */
  ratearFrete(lineTotals: Numeric[], freteTotal: Numeric): Prisma.Decimal[] {
    const total = add(...lineTotals);
    const frete = toDecimal(freteTotal);
    if (total.isZero() || frete.isZero()) {
      return lineTotals.map(() => new Prisma.Decimal(0));
    }
    return lineTotals.map((lt) => money(mul(frete, div(lt, total))));
  },

  /** Preço de venda sugerido a partir do custo e de uma margem alvo (fração, ex.: 0.30 = 30%). */
  precoVendaSugerido(custoUnitario: Numeric, margemAlvo: Numeric = 0.3) {
    return money(mul(custoUnitario, add(1, margemAlvo)));
  },

  /** Total de uma venda: quantidade * valor unitário. */
  valorTotalVenda(quantidade: Numeric, valorUnitario: Numeric) {
    return money(mul(quantidade, valorUnitario));
  },

  /** Lucro bruto = total vendido - custo dos produtos vendidos (CMV). */
  lucroBruto(totalVendido: Numeric, custoProdutosVendidos: Numeric) {
    return money(sub(totalVendido, custoProdutosVendidos));
  },

  /** Lucro líquido = lucro bruto - despesas. */
  lucroLiquido(lucroBruto: Numeric, despesas: Numeric) {
    return money(sub(lucroBruto, despesas));
  },

  /** Margem líquida percentual. Retorna 0 quando não há vendas (evita divisão por zero). */
  margemLiquida(lucroLiquido: Numeric, totalVendido: Numeric): Prisma.Decimal {
    const tv = toDecimal(totalVendido);
    if (tv.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);
    return mul(div(lucroLiquido, tv), 100).toDecimalPlaces(2);
  },

  /** Saldo restante de um fiado: total - pago (nunca negativo). */
  saldoFiado(totalAmount: Numeric, paidAmount: Numeric): Prisma.Decimal {
    const restante = sub(totalAmount, paidAmount);
    return restante.isNegative() ? new Prisma.Decimal(0) : money(restante);
  },

  /** Totais de despesas separados por tipo. */
  totaisDespesas(
    despesas: { type: "FIXA" | "VARIAVEL"; amount: Numeric }[],
  ): { fixas: Prisma.Decimal; variaveis: Prisma.Decimal; geral: Prisma.Decimal } {
    const fixas = add(
      ...despesas.filter((d) => d.type === "FIXA").map((d) => d.amount),
    );
    const variaveis = add(
      ...despesas.filter((d) => d.type === "VARIAVEL").map((d) => d.amount),
    );
    return { fixas: money(fixas), variaveis: money(variaveis), geral: money(add(fixas, variaveis)) };
  },

  /** Valor total em estoque = Σ(quantidade * custo unitário). */
  valorTotalEstoque(
    itens: { quantidade: Numeric; custoUnitario: Numeric }[],
  ): Prisma.Decimal {
    return money(
      add(...itens.map((i) => mul(i.quantidade, i.custoUnitario))),
    );
  },
};

export type FinancialCalcService = typeof FinancialCalc;
