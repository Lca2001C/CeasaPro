import { Prisma } from "@prisma/client";
import { add, sub, mul, div, money, toDecimal, type Numeric } from "@/lib/money";

/**
 * FinancialCalcService — ÚNICA fonte das fórmulas financeiras (README §9).
 * Funções puras (sem I/O), fáceis de testar. Nenhuma regra financeira deve
 * existir fora deste módulo.
 *
 *   valor_total_compra = quantidade * preco_unitario + frete
 *   valor_total_venda  = quantidade * valor_unitario
 *   faturamento        = vendas_de_mercadoria + vendas_de_embalagem
 *   custo_do_vendido   = cmv_da_mercadoria + custo_das_embalagens_vendidas + perdas_de_estoque
 *   lucro_bruto        = faturamento - custo_do_vendido
 *   lucro_liquido      = lucro_bruto - despesas - perdas_com_fiado + recuperado_de_fiado_baixado
 *   margem_liquida     = (lucro_liquido / faturamento) * 100
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
   * Retorna o frete atribuído a cada item, na mesma ordem. A soma das partes é
   * SEMPRE o frete informado.
   *
   * Duas correções:
   *
   * - **Compra de valor zero** (consignação, bonificação, preço acertado
   *   depois): com todas as linhas a R$ 0 não há valor para ratear, e cada item
   *   recebia R$ 0 de frete — a compra ficava com `totalAmount` de R$ 200 e
   *   nenhum centavo no custo do estoque nem no CMV. Agora o rateio cai para a
   *   QUANTIDADE de cada linha (`quantidades`), ou partes iguais sem ela.
   * - **Resíduo do arredondamento**: cada parte é arredondada a centavos, e a
   *   soma podia ficar um centavo acima ou abaixo do frete (R$ 0,10 em três
   *   linhas iguais dava 0,03 × 3 = 0,09). O resíduo vai para a linha de MAIOR
   *   parte — nunca para uma linha de parte zero, que ficaria com frete
   *   negativo.
   */
  ratearFrete(
    lineTotals: Numeric[],
    freteTotal: Numeric,
    quantidades?: Numeric[],
  ): Prisma.Decimal[] {
    const frete = toDecimal(freteTotal);
    if (lineTotals.length === 0 || frete.isZero()) {
      return lineTotals.map(() => new Prisma.Decimal(0));
    }

    // Base do rateio: valor da linha; sem valor, a quantidade; sem ela, 1 a 1.
    let pesos = lineTotals.map((lt) => toDecimal(lt));
    if (add(...pesos).isZero()) {
      pesos =
        quantidades && quantidades.length === lineTotals.length && !add(...quantidades).isZero()
          ? quantidades.map((q) => toDecimal(q))
          : lineTotals.map(() => new Prisma.Decimal(1));
    }
    const base = add(...pesos);

    const partes = pesos.map((p) => money(mul(frete, div(p, base))));
    const residuo = sub(money(frete), add(...partes));
    if (!residuo.isZero()) {
      let maior = 0;
      partes.forEach((p, i) => {
        if (p.greaterThan(partes[maior]!)) maior = i;
      });
      partes[maior] = money(partes[maior]!.plus(residuo));
    }
    return partes;
  },

  /** Preço de venda sugerido a partir do custo e de uma margem alvo (fração, ex.: 0.30 = 30%). */
  precoVendaSugerido(custoUnitario: Numeric, margemAlvo: Numeric = 0.3) {
    return money(mul(custoUnitario, add(1, margemAlvo)));
  },

  /** Total de uma venda: quantidade * valor unitário. */
  valorTotalVenda(quantidade: Numeric, valorUnitario: Numeric) {
    return money(mul(quantidade, valorUnitario));
  },

  /**
   * Receita LÍQUIDA de cada linha de uma venda: o desconto da VENDA
   * (`Sale.discountAmount`) rateado entre as linhas, proporcional ao
   * `lineTotal` de cada uma.
   *
   * `lineTotal` já é líquido do desconto da LINHA, mas o desconto da venda só
   * existe no total (`totalAmount = Σ lineTotal − desconto da venda`). Somar
   * `lineTotal` cru por produto dava receita e lucro por produto maiores que o
   * total vendido — "Lucro por produto" nunca fechava com o relatório de
   * vendas, e a venda que deu prejuízo depois do desconto não aparecia em
   * "Com prejuízo".
   *
   * Recebe o `totalAmount` gravado (e não o desconto) de propósito: ele já traz
   * o piso em zero, e a soma das partes é SEMPRE esse total — o resíduo de
   * arredondamento vai para a linha de maior valor, como no rateio do frete.
   * Sem desconto (total ≥ soma das linhas), as linhas voltam como estão.
   */
  receitaLiquidaPorLinha(lineTotals: Numeric[], totalVenda: Numeric): Prisma.Decimal[] {
    const linhas = lineTotals.map((lt) => toDecimal(lt));
    const soma = add(...linhas);
    const total = toDecimal(totalVenda);
    if (linhas.length === 0) return [];
    if (total.greaterThanOrEqualTo(soma)) return linhas.map((l) => money(l));
    if (total.lessThanOrEqualTo(0) || soma.isZero()) {
      return linhas.map(() => new Prisma.Decimal(0));
    }

    const partes = linhas.map((l) => money(div(mul(l, total), soma)));
    const residuo = sub(money(total), add(...partes));
    if (!residuo.isZero()) {
      let maior = 0;
      partes.forEach((p, i) => {
        if (p.greaterThan(partes[maior]!)) maior = i;
      });
      partes[maior] = money(partes[maior]!.plus(residuo));
    }
    return partes;
  },

  /**
   * Faturamento do período = venda de mercadoria + venda avulsa de embalagem.
   *
   * A embalagem não passa pelo PDV, mas é dinheiro vendido: fora daqui, o caixa
   * mostrava uma receita que o lucro e o "% do que você vendeu" não viam. O
   * custo dela entra em `custoDoVendido`.
   */
  faturamento(vendasDeMercadoria: Numeric, vendasDeEmbalagem: Numeric = 0) {
    return money(add(vendasDeMercadoria, vendasDeEmbalagem));
  },

  /** Lucro bruto = total vendido - custo dos produtos vendidos (CMV). */
  lucroBruto(totalVendido: Numeric, custoProdutosVendidos: Numeric) {
    return money(sub(totalVendido, custoProdutosVendidos));
  },

  /**
   * Custo da mercadoria = CMV do que foi vendido + custo médio das embalagens
   * vendidas (`PackagingSale.unitCostAtSale × quantidade`) + perdas e acertos
   * de estoque do mês (quebra, doação, acerto para baixo — menos o acerto para
   * cima), pelo custo gravado no movimento.
   *
   * Sem a perda, a mercadoria que estragou não descontava em lugar nenhum: a
   * conta da compra fica fora do lucro "porque já está no CMV", e o CMV só via
   * o que foi VENDIDO. Em hortifruti, perda é diária — o lucro saía sempre
   * para cima.
   */
  custoDoVendido(cmvMercadoria: Numeric, custoEmbalagens: Numeric = 0, perdasDeEstoque: Numeric = 0) {
    return money(add(cmvMercadoria, custoEmbalagens, perdasDeEstoque));
  },

  /**
   * Custo médio ponderado MÓVEL de um item a partir do livro-razão dele, na
   * ordem de gravação — a mesma regra do estoque de mercadoria
   * (`sqlCustoEstoque`): a entrada com custo pondera com o que sobrou, a saída
   * sai pela média sem alterá-la, e saldo ≤ 0 zera a média (a próxima entrada
   * recomeça). Entrada SEM custo soma ao saldo e mantém a média.
   *
   * Devolve `null` quando nenhuma entrada com custo formou a média.
   */
  custoMedioMovel(
    movimentos: { entrada: boolean; quantidade: Numeric; custoUnitario: Numeric | null }[],
  ): Prisma.Decimal | null {
    let saldo = toDecimal(0);
    let media: Prisma.Decimal | null = null;
    for (const m of movimentos) {
      const q = toDecimal(m.quantidade);
      if (m.entrada && q.greaterThan(0)) {
        if (m.custoUnitario !== null) {
          const c = toDecimal(m.custoUnitario);
          media =
            media !== null && saldo.greaterThan(0)
              ? div(add(mul(saldo, media), mul(q, c)), add(saldo, q))
              : c;
        }
        saldo = add(saldo, q);
      } else {
        saldo = sub(saldo, q.abs());
        if (saldo.lessThanOrEqualTo(0)) {
          saldo = toDecimal(0);
          media = null;
        }
      }
    }
    return media === null ? null : media.toDecimalPlaces(4);
  },

  /** Custo de uma venda de embalagem: quantidade × custo médio na hora da venda. */
  custoVendaEmbalagem(quantidade: Numeric, custoUnitario: Numeric) {
    return money(mul(quantidade, custoUnitario));
  },

  /**
   * Lucro líquido = lucro bruto - despesas - perdas com fiado.
   *
   * A perda com fiado (`CreditAccount.writtenOffAmount`) entra no mês da
   * BAIXA: a venda já foi faturamento no mês dela, e o que não vai ser
   * recebido sai do resultado de agora, sem reescrever o mês fechado. Pelo
   * mesmo motivo, o que o cliente paga DEPOIS da baixa
   * (`CreditPayment.aposBaixa`) volta ao resultado no mês em que entra.
   */
  lucroLiquido(
    lucroBruto: Numeric,
    despesas: Numeric,
    perdasComFiado: Numeric = 0,
    recuperadoDeFiado: Numeric = 0,
  ) {
    return money(add(sub(sub(lucroBruto, despesas), perdasComFiado), recuperadoDeFiado));
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
