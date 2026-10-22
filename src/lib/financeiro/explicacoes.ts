import { add, money, sub, toDecimal, type Numeric } from "@/lib/money";
import { formatBRL, formatQty } from "@/lib/format";
import { APP_TIME_ZONE } from "@/lib/tz";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { DashboardSummary } from "@/lib/services/dashboard.service";
import type { PainelFinanceiro } from "@/lib/services/painel-financeiro.service";

/**
 * "Como é calculado" de cada número do Início.
 *
 * O dono do box toca o card e vê a conta montada com os MESMOS números que a
 * tela mostra — nenhuma consulta nova: tudo sai do resumo
 * (`DashboardService.getSummary`) e do painel (`PainelFinanceiroService`), na
 * mesma ordem das fórmulas de `FinancialCalc`. Se a conta da janela não fechar
 * com o card, é bug: `tests/unit/explicacoes-inicio.test.ts` confere que cada
 * soma bate com o total.
 *
 * Tudo sai como texto pronto (serializável), porque a janela é componente de
 * cliente e não pode importar `@/lib/money` (traz o runtime do Prisma).
 */

export interface ParcelaExplicada {
  rotulo: string;
  /** Valor sem sinal, formatado. O sinal vai em `sinal`. */
  valor: string;
  sinal: "+" | "−";
  /** Valor com sinal, em centavos — só para conferir a soma nos testes. */
  centavos: number;
  detalhe?: string;
}

export interface Explicacao {
  titulo: string;
  /** Uma frase: o que o número é. */
  resumo: string;
  /** A janela de datas, em português. */
  periodo: string;
  /** A conta, parcela por parcela, quando o número é uma soma. */
  parcelas: ParcelaExplicada[];
  /** A linha do resultado ("= Sobrou"). Com `centavos` para o teste. */
  total: { rotulo: string; valor: string; centavos: number } | null;
  /** Conta que não é soma (porcentagem): linhas de texto, na ordem. */
  formula?: string[];
  /** Números de apoio, que não entram na conta ("No mês: R$ …"). */
  extras?: { rotulo: string; valor: string }[];
  entra: string[];
  foraDaConta: string[];
  link?: { href: string; rotulo: string };
}

const centavos = (v: Numeric) => toDecimal(v).times(100).round().toNumber();

function parcela(rotulo: string, valor: Numeric, sinal: "+" | "−", detalhe?: string): ParcelaExplicada {
  const v = money(toDecimal(valor));
  return {
    rotulo,
    valor: formatBRL(v.abs()),
    sinal,
    centavos: sinal === "+" ? centavos(v) : -centavos(v),
    ...(detalhe ? { detalhe } : {}),
  };
}

/** Parcela que pode ser positiva ou negativa (acerto de estoque para cima). */
function parcelaComSinal(rotulo: string, valorQueSubtrai: Numeric, detalhe?: string) {
  const v = toDecimal(valorQueSubtrai);
  return v.isNegative() ? parcela(rotulo, v.negated(), "+", detalhe) : parcela(rotulo, v, "−", detalhe);
}

function totalDe(rotulo: string, valor: Numeric) {
  const v = money(toDecimal(valor));
  return { rotulo, valor: formatBRL(v), centavos: centavos(v) };
}

const naoZero = (v: Numeric) => !toDecimal(v).isZero();

function nomeDoMesAtual(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: APP_TIME_ZONE }).format(agora);
}

const periodoDoMes = (agora: Date) => `De 1º de ${nomeDoMesAtual(agora)} até agora.`;
const periodoDasContas = (agora: Date) =>
  `Contas com vencimento em ${nomeDoMesAtual(agora)} (o mês inteiro, pagas ou não). Sem vencimento, conta a data em que foi lançada.`;

// ──────────────────────────── As parcelas do lucro ────────────────────────────
// A mesma ordem de `FinancialCalc`: faturamento − custo do vendido = lucro
// bruto; lucro bruto − contas − perda com fiado + recuperado = lucro líquido.

function parcelasDoFaturamento(s: DashboardSummary): ParcelaExplicada[] {
  return [
    parcela("Vendi (mercadoria)", s.mesVendi, "+"),
    ...(naoZero(s.embalagensMes) ? [parcela("Vendi em embalagens", s.embalagensMes, "+")] : []),
  ];
}

function parcelasDoCustoDoVendido(s: DashboardSummary): ParcelaExplicada[] {
  return [
    parcela(
      "Custo da mercadoria vendida",
      s.cmvMes,
      "−",
      "Quanto custou (pelo custo médio da compra, com frete) cada coisa que você vendeu.",
    ),
    ...(naoZero(s.custoEmbalagensMes)
      ? [parcela("Custo das embalagens (vendidas e baixadas)", s.custoEmbalagensMes, "−")]
      : []),
    ...(naoZero(s.perdasEstoqueMes)
      ? [
          parcelaComSinal(
            "Perdas e acertos de estoque",
            s.perdasEstoqueMes,
            "Quebra, doação e acerto para baixo, pelo custo. Acerto para cima soma de volta.",
          ),
        ]
      : []),
  ];
}

function parcelasDoLucroLiquido(s: DashboardSummary): ParcelaExplicada[] {
  return [
    ...parcelasDoFaturamento(s),
    ...parcelasDoCustoDoVendido(s),
    parcela(
      "Contas do mês",
      s.despesasLucroMes,
      "−",
      naoZero(s.higienizacaoMes)
        ? `Contas fixas e variáveis, com ${formatBRL(s.higienizacaoMes)} de higienização enviada no mês.`
        : "Contas fixas e variáveis do mês.",
    ),
    ...(naoZero(s.perdasFiadoMes)
      ? [parcela("Perda com fiado", s.perdasFiadoMes, "−", "Fiado baixado como perda neste mês.")]
      : []),
    ...(naoZero(s.recuperadoFiadoMes)
      ? [
          parcela(
            "Recebido de fiado baixado",
            s.recuperadoFiadoMes,
            "+",
            "Cliente que pagou depois de o fiado ter sido baixado como perda.",
          ),
        ]
      : []),
  ];
}

const FORA_DO_LUCRO = [
  "O valor das COMPRAS do mês: a mercadoria só vira custo quando é vendida (linha \"Custo da mercadoria vendida\").",
  "Contas geradas por compra (mercadoria, frete, embalagem): o custo delas já está no custo da mercadoria.",
  "Fiado recebido de vendas antigas: a venda já contou no mês em que foi feita.",
  "Vendas e lançamentos cancelados.",
];

// ─────────────────────────────── Cada card ───────────────────────────────

export function explicarHojeVendi(s: DashboardSummary): Explicacao {
  return {
    titulo: "Hoje vendi",
    resumo: "A soma das vendas de mercadoria registradas hoje.",
    periodo: "Hoje, desde a meia-noite (horário de Brasília).",
    parcelas: [],
    total: totalDe("Hoje vendi", s.hojeVendi),
    extras: [
      { rotulo: "Nos últimos 7 dias", valor: formatBRL(s.semanaVendi) },
      { rotulo: "No mês até agora", valor: formatBRL(s.mesVendi) },
    ],
    entra: [
      "Vendas do PDV e fiados lançados com data de hoje: à vista, fiado ou misto.",
      "O fiado conta no dia da VENDA, não no dia em que o cliente paga.",
      "O valor já com o desconto dado na venda.",
    ],
    foraDaConta: [
      "Vendas canceladas.",
      "Venda de embalagem avulsa (aparece no Financeiro, em \"Vendi em embalagens\").",
      "Dinheiro recebido hoje de fiado antigo.",
    ],
    link: { href: "/vendas", rotulo: "Ver as vendas" },
  };
}

export function explicarSemanaVendi(s: DashboardSummary): Explicacao {
  return {
    ...explicarHojeVendi(s),
    titulo: "Vendi na semana",
    resumo: "A soma das vendas de mercadoria dos últimos 7 dias.",
    periodo: "Os últimos 7 dias, contando hoje.",
    total: totalDe("Vendi na semana", s.semanaVendi),
    extras: [{ rotulo: "Só hoje", valor: formatBRL(s.hojeVendi) }],
  };
}

export function explicarMesVendi(s: DashboardSummary, agora: Date): Explicacao {
  return {
    ...explicarHojeVendi(s),
    titulo: "Vendi no mês",
    resumo: "A soma das vendas de mercadoria do mês.",
    periodo: periodoDoMes(agora),
    total: totalDe("Vendi no mês", s.mesVendi),
    extras: [
      { rotulo: "Só hoje", valor: formatBRL(s.hojeVendi) },
      ...(naoZero(s.embalagensMes)
        ? [{ rotulo: "Venda de embalagem no mês (fora desta soma)", valor: formatBRL(s.embalagensMes) }]
        : []),
    ],
  };
}

export function explicarAReceber(s: DashboardSummary): Explicacao {
  return {
    titulo: "Clientes me devem",
    resumo:
      "Para cada fiado em aberto: o valor da venda menos o que o cliente já pagou. O card soma o que falta de todos.",
    periodo: "Todos os fiados em aberto, de qualquer data.",
    parcelas: [],
    total: totalDe("Falta receber", s.aReceber),
    entra: [
      "Fiado em aberto de qualquer mês, inclusive os que ainda não venceram.",
      "Pagamento parcial já descontado: se a venda foi R$ 100 e o cliente pagou R$ 30, entram R$ 70.",
    ],
    foraDaConta: [
      "Fiado já quitado.",
      "Fiado baixado como perda (o cliente não vai pagar).",
      "Fiado de venda cancelada.",
    ],
    link: { href: "/fiado", rotulo: "Ver o fiado" },
  };
}

export function explicarEstoque(s: DashboardSummary): Explicacao {
  return {
    titulo: "Tenho em estoque",
    resumo:
      "Para cada produto: a quantidade em estoque × o custo médio dele. O card soma todos os produtos.",
    periodo: "A posição de agora.",
    parcelas: [],
    total: totalDe("Valor do estoque", s.estoqueValor),
    entra: [
      "Produtos com quantidade maior que zero.",
      "Custo médio = média das compras que ainda estão no estoque, com o frete rateado em cada item.",
      "Compras, vendas, quebras e ajustes mexem na quantidade.",
    ],
    foraDaConta: [
      "Produto zerado ou negativo (vale zero).",
      "Produto excluído.",
      "O preço de VENDA: o card mostra quanto a mercadoria custou, não quanto vai render.",
    ],
    link: { href: "/estoque", rotulo: "Ver o estoque" },
  };
}

export function explicarLucro(s: DashboardSummary, agora: Date): Explicacao {
  const negativo = s.lucroMes.isNegative();
  return {
    titulo: "Sobrou no mês",
    resumo:
      "O que você vendeu, menos o que custou o que foi vendido, menos as contas do mês. É o lucro líquido.",
    periodo: `${periodoDoMes(agora)} As contas entram pelo vencimento, no mês inteiro.`,
    parcelas: parcelasDoLucroLiquido(s),
    total: totalDe(negativo ? "Prejuízo" : "Sobrou", s.lucroMes),
    entra: [
      "Vendas de mercadoria (e de embalagem, se você usa) do mês, pelo dia da venda.",
      "Custo do que foi vendido, quebras e acertos de estoque.",
      "Contas fixas e variáveis com vencimento no mês, pagas ou não, e a higienização enviada no mês.",
      "Fiado baixado como perda neste mês, e o que entrou depois de uma baixa.",
    ],
    foraDaConta: FORA_DO_LUCRO,
    link: { href: "/relatorios", rotulo: "Ver os relatórios" },
  };
}

export function explicarMargem(s: DashboardSummary, agora: Date): Explicacao {
  const faturamento = add(s.mesVendi, s.embalagensMes);
  const semVenda = faturamento.lessThanOrEqualTo(0);
  return {
    titulo: "Sobrou em %",
    resumo: "De cada R$ 100 que você vendeu no mês, quantos reais sobraram depois de tudo.",
    periodo: periodoDoMes(agora),
    parcelas: [],
    total: null,
    formula: semVenda
      ? ["Ainda não há venda no mês: sem venda, não dá para calcular a porcentagem, e o card mostra 0%."]
      : [
          `Sobrou no mês: ${formatBRL(s.lucroMes)}`,
          `Vendi no mês${naoZero(s.embalagensMes) ? " (mercadoria + embalagem)" : ""}: ${formatBRL(faturamento)}`,
          `${formatBRL(s.lucroMes)} ÷ ${formatBRL(faturamento)} × 100 = ${formatQty(s.margemLiquidaMes)}%`,
        ],
    entra: ["O mesmo \"Sobrou no mês\" e o mesmo total vendido dos outros cards."],
    foraDaConta: ["As compras do mês (entram só pelo custo do que foi vendido)."],
  };
}

export function explicarComprei(s: DashboardSummary, agora: Date): Explicacao {
  return {
    titulo: "Comprei no mês",
    resumo: "A soma das compras de mercadoria do mês: o valor dos itens mais o frete.",
    periodo: `${periodoDoMes(agora)} Pela data da compra.`,
    parcelas: [],
    total: totalDe("Comprei no mês", s.totalCompradoMes),
    entra: ["Todas as compras registradas com data neste mês, pagas ou não."],
    foraDaConta: [
      "Compras canceladas.",
      "Compra de embalagem.",
      "Este valor NÃO desconta do lucro: a mercadoria vira custo quando é vendida (\"Custo da mercadoria vendida\").",
    ],
    link: { href: "/estoque?aba=compras", rotulo: "Ver as compras" },
  };
}

export function explicarGanhei(s: DashboardSummary, agora: Date): Explicacao {
  return {
    titulo: "Ganhei nas vendas",
    resumo: "O que você vendeu menos o que custou o que foi vendido. É o lucro bruto, antes das contas.",
    periodo: periodoDoMes(agora),
    parcelas: [...parcelasDoFaturamento(s), ...parcelasDoCustoDoVendido(s)],
    total: totalDe("Ganhei nas vendas", s.lucroBrutoMes),
    entra: [
      "Vendas do mês pelo dia da venda (o fiado conta na venda, não no pagamento).",
      "O custo de cada item vendido, gravado na hora da venda pelo custo médio.",
    ],
    foraDaConta: [
      "As contas do mês (descontadas em \"Sobrou no mês\").",
      "O valor das compras do mês.",
      "Vendas canceladas.",
    ],
    link: { href: "/relatorios/lucro_produto", rotulo: "Ver o lucro por produto" },
  };
}

export function explicarFixas(s: DashboardSummary, agora: Date): Explicacao {
  return {
    titulo: "Contas fixas",
    resumo: "A soma das contas lançadas como FIXAS: as que se repetem todo mês (aluguel, luz, salário…).",
    periodo: periodoDasContas(agora),
    parcelas: [],
    total: totalDe("Contas fixas", s.despesasFixasMes),
    entra: ["Contas fixas do mês, pagas ou ainda a pagar."],
    foraDaConta: [
      "Contas geradas por compra (o custo já está no custo da mercadoria).",
      "Contas excluídas.",
    ],
    link: { href: "/despesas", rotulo: "Ver as contas" },
  };
}

export function explicarVariaveis(s: DashboardSummary, agora: Date): Explicacao {
  const lancadas = sub(s.despesasVariaveisMes, s.higienizacaoMes);
  return {
    titulo: "Contas variáveis",
    resumo: "A soma das contas que mudam de mês para mês (gás, manutenção, sacola…).",
    periodo: periodoDasContas(agora),
    parcelas: naoZero(s.higienizacaoMes)
      ? [
          parcela("Contas variáveis lançadas", lancadas, "+"),
          parcela(
            "Higienização enviada no mês",
            s.higienizacaoMes,
            "+",
            "Pela data de envio das caixas, pagas ou não.",
          ),
        ]
      : [],
    total: totalDe("Contas variáveis", s.despesasVariaveisMes),
    entra: ["Contas variáveis do mês, pagas ou ainda a pagar.", "Higienização enviada no mês, se você usa."],
    foraDaConta: [
      "Contas geradas por compra (o custo já está no custo da mercadoria).",
      "Contas excluídas.",
    ],
    link: { href: "/despesas", rotulo: "Ver as contas" },
  };
}

// ─────────────────────────────── Gráficos ───────────────────────────────

export function explicarResultado(s: DashboardSummary, agora: Date): Explicacao {
  return { ...explicarLucro(s, agora), titulo: "Resultado do mês" };
}

export function explicarVendas30Dias(s: DashboardSummary): Explicacao {
  const soma = add(...s.chart.map((d) => d.total), 0);
  return {
    titulo: "Vendas de mercadoria dos últimos 30 dias",
    resumo: "Uma barra por dia: a soma das vendas de mercadoria daquele dia.",
    periodo: "Os últimos 30 dias, contando hoje.",
    parcelas: [],
    total: totalDe("Soma dos 30 dias", soma),
    entra: ["As mesmas vendas do \"Hoje vendi\", dia a dia (o fiado conta no dia da venda)."],
    foraDaConta: ["Vendas canceladas.", "Venda de embalagem avulsa."],
    link: { href: "/vendas", rotulo: "Ver as vendas" },
  };
}

export function explicarUltimosMeses(): Explicacao {
  return {
    titulo: "Últimos 6 meses",
    resumo: "Três barras por mês, para comparar um mês com o outro.",
    periodo: "Os 6 últimos meses, contando o atual (até agora).",
    parcelas: [],
    total: null,
    formula: [
      "Vendas = mercadoria + embalagem vendida no mês, pelo dia da venda.",
      "Compras = total das compras de mercadoria do mês (itens + frete), pela data da compra.",
      "Contas = contas fixas e variáveis pelo vencimento, mais a higienização pela data de envio.",
      "No mês atual, Vendas e Contas fecham com o \"Resultado do mês\".",
    ],
    entra: ["O que cada mês teve, pago ou não."],
    foraDaConta: [
      "Lançamentos cancelados.",
      "Contas geradas por compra (já estão em Compras).",
      "Compras não são o custo do lucro: o lucro desconta o custo do que foi VENDIDO.",
    ],
  };
}

export function explicarComoRecebi(p: PainelFinanceiro, agora: Date): Explicacao {
  const soma = add(...p.formasDePagamento.map((f) => f.total), 0);
  return {
    titulo: "Como recebi no mês",
    resumo: "As vendas do mês separadas pela forma de pagamento.",
    periodo: periodoDoMes(agora),
    parcelas: p.formasDePagamento.map((f) =>
      parcela(
        f.chave === "EMBALAGEM" ? "Venda de embalagem" : (PAYMENT_METHOD_LABELS[f.chave] ?? f.chave),
        f.total,
        "+",
      ),
    ),
    total: totalDe("Total vendido", soma),
    entra: [
      "Venda mista (parte PIX, parte fiado…) entra em cada forma pela parte dela.",
      "Fiado entra como \"Fiado\" no dia da venda, mesmo que ainda não tenha sido pago.",
    ],
    foraDaConta: ["Vendas canceladas.", "Dinheiro recebido de fiado de vendas antigas."],
    link: { href: "/vendas", rotulo: "Ver as vendas" },
  };
}

export function explicarParaOndeContas(
  s: DashboardSummary,
  p: PainelFinanceiro,
  agora: Date,
): Explicacao {
  return {
    titulo: "Para onde foram as contas",
    resumo: "As contas do mês separadas por categoria. As menores ficam juntas em \"Outras\".",
    periodo: periodoDasContas(agora),
    parcelas: p.contasPorCategoria.map((c) => parcela(c.chave, c.total, "+")),
    total: totalDe("Contas do mês", s.despesasLucroMes),
    entra: [
      "Contas fixas e variáveis do mês, pagas ou não.",
      "Higienização enviada no mês, numa linha própria.",
    ],
    foraDaConta: ["Contas geradas por compra (o custo já está no custo da mercadoria)."],
    link: { href: "/despesas", rotulo: "Ver as contas" },
  };
}

/** Para o teste: a soma das parcelas, em centavos. */
export function somaDasParcelas(e: Explicacao): number {
  return e.parcelas.reduce((a, p) => a + p.centavos, 0);
}

