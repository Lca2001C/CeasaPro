import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import type { DashboardSummary } from "@/lib/services/dashboard.service";
import type { PainelFinanceiro } from "@/lib/services/painel-financeiro.service";
import * as Explica from "@/lib/financeiro/explicacoes";

/**
 * A conta que a janela "Como é calculado" mostra tem de fechar com o número do
 * card. O resumo de teste é montado pelas MESMAS fórmulas de `FinancialCalc`
 * que o `DashboardService` usa — se alguém mudar a fórmula sem mudar a
 * explicação (ou o contrário), a soma deixa de bater aqui.
 */

const D = (v: number) => new Prisma.Decimal(v);
const AGORA = new Date("2026-10-22T15:00:00.000Z");

function resumo(o: {
  mesVendi: number;
  embalagens?: number;
  cmv: number;
  custoEmbalagens?: number;
  perdasEstoque?: number;
  contas: number;
  higienizacao?: number;
  fixas?: number;
  perdasFiado?: number;
  recuperado?: number;
  vendasSemCusto?: number;
}): DashboardSummary {
  const faturamento = FinancialCalc.faturamento(o.mesVendi, o.embalagens ?? 0);
  const baseDoLucro = faturamento.minus(o.vendasSemCusto ?? 0);
  const lucroBruto = FinancialCalc.lucroBruto(
    baseDoLucro,
    FinancialCalc.custoDoVendido(o.cmv, o.custoEmbalagens ?? 0, o.perdasEstoque ?? 0),
  );
  const lucro = FinancialCalc.lucroLiquido(lucroBruto, o.contas, o.perdasFiado ?? 0, o.recuperado ?? 0);
  const fixas = o.fixas ?? 0;
  return {
    hojeVendi: D(120),
    semanaVendi: D(800),
    mesVendi: D(o.mesVendi),
    totalCompradoMes: D(5000),
    aReceber: D(350),
    contasPagar: D(0),
    estoqueValor: D(4200),
    lucroBrutoMes: lucroBruto,
    cmvMes: D(o.cmv),
    embalagensMes: D(o.embalagens ?? 0),
    custoEmbalagensMes: D(o.custoEmbalagens ?? 0),
    embalagensSemCusto: 0,
    vendasSemCustoMes: D(o.vendasSemCusto ?? 0),
    vendasSemCusto: 0,
    perdasEstoqueMes: D(o.perdasEstoque ?? 0),
    perdasFiadoMes: D(o.perdasFiado ?? 0),
    recuperadoFiadoMes: D(o.recuperado ?? 0),
    despesasLucroMes: D(o.contas),
    lucroMes: lucro,
    margemLiquidaMes: FinancialCalc.margemLiquida(lucro, baseDoLucro),
    despesasFixasMes: D(fixas),
    despesasVariaveisMes: D(o.contas - fixas),
    higienizacaoMes: D(o.higienizacao ?? 0),
    topVendidos: [],
    topLucrativos: [],
    produtosComPrejuizo: [],
    estoqueParado: [],
    chart: [
      { date: "2026-10-21", total: 300 },
      { date: "2026-10-22", total: 120.5 },
    ],
  };
}

const fecha = (e: Explica.Explicacao) => {
  expect(e.total).not.toBeNull();
  expect(Explica.somaDasParcelas(e)).toBe(e.total!.centavos);
};

const CASOS = {
  simples: resumo({ mesVendi: 10_000, cmv: 6_000, contas: 1_500, fixas: 1_000 }),
  completo: resumo({
    mesVendi: 10_000.37,
    embalagens: 420.1,
    cmv: 6_100.55,
    custoEmbalagens: 210.33,
    perdasEstoque: 155.2,
    contas: 1_830.4,
    higienizacao: 230.4,
    fixas: 900,
    perdasFiado: 80,
    recuperado: 25.5,
  }),
  // Acerto de estoque para CIMA maior que a perda: a parcela soma de volta.
  acertoParaCima: resumo({ mesVendi: 2_000, cmv: 1_200, perdasEstoque: -50, contas: 300 }),
  prejuizo: resumo({ mesVendi: 1_000, cmv: 900, contas: 800, perdasFiado: 200 }),
};

describe("a conta da janela fecha com o card", () => {
  for (const [nome, s] of Object.entries(CASOS)) {
    describe(nome, () => {
      it("Sobrou no mês", () => fecha(Explica.explicarLucro(s, AGORA)));
      it("Resultado do mês (gráfico)", () => fecha(Explica.explicarResultado(s, AGORA)));
      it("Ganhei nas vendas", () => fecha(Explica.explicarGanhei(s, AGORA)));
      it("Contas variáveis (com higienização)", () => {
        const e = Explica.explicarVariaveis(s, AGORA);
        if (e.parcelas.length > 0) fecha(e);
        else expect(s.higienizacaoMes.isZero()).toBe(true);
      });
    });
  }
});

describe("detalhes da conta", () => {
  it("o acerto para cima aparece somando, não subtraindo", () => {
    const e = Explica.explicarLucro(CASOS.acertoParaCima, AGORA);
    const linha = e.parcelas.find((p) => p.rotulo === "Perdas e acertos de estoque");
    expect(linha?.sinal).toBe("+");
  });

  it("prejuízo vira o rótulo do total", () => {
    expect(Explica.explicarLucro(CASOS.prejuizo, AGORA).total?.rotulo).toBe("Prejuízo");
  });

  it("parcelas zeradas não aparecem (embalagem, fiado, perdas)", () => {
    const rotulos = Explica.explicarLucro(CASOS.simples, AGORA).parcelas.map((p) => p.rotulo);
    expect(rotulos).toEqual(["Vendi (mercadoria)", "Custo da mercadoria vendida", "Contas do mês"]);
  });

  it("a margem mostra a divisão com os números do mês", () => {
    const e = Explica.explicarMargem(CASOS.simples, AGORA);
    // 2.500 ÷ 10.000 × 100 = 25%
    expect(e.formula?.at(-1)).toMatch(/÷/);
    expect(e.formula?.at(-1)).toMatch(/25%$/);
  });

  it("sem venda no mês, a margem explica o 0%", () => {
    const s = resumo({ mesVendi: 0, cmv: 0, contas: 100 });
    expect(Explica.explicarMargem(s, AGORA).formula?.[0]).toMatch(/0%/);
  });

  it("o período fala o mês no fuso do app", () => {
    expect(Explica.explicarLucro(CASOS.simples, AGORA).periodo).toContain("outubro");
  });

  it("Como recebi: a soma das formas é o total", () => {
    const painel: PainelFinanceiro = {
      meses: [],
      formasDePagamento: [
        { chave: "PIX", total: 500.1 },
        { chave: "FIADO", total: 300 },
        { chave: "EMBALAGEM", total: 40.25 },
      ],
      contasPorCategoria: [],
    };
    fecha(Explica.explicarComoRecebi(painel, AGORA));
  });

  it("os 30 dias somam as barras", () => {
    expect(Explica.explicarVendas30Dias(CASOS.simples).total?.centavos).toBe(42050);
  });

  it("cada card tem o que entra e o que fica de fora", () => {
    const s = CASOS.completo;
    for (const e of [
      Explica.explicarHojeVendi(s),
      Explica.explicarSemanaVendi(s),
      Explica.explicarMesVendi(s, AGORA),
      Explica.explicarAReceber(s),
      Explica.explicarEstoque(s),
      Explica.explicarComprei(s, AGORA),
      Explica.explicarFixas(s, AGORA),
      Explica.explicarUltimosMeses(),
    ]) {
      expect(e.entra.length).toBeGreaterThan(0);
      expect(e.foraDaConta.length).toBeGreaterThan(0);
      expect(e.resumo.length).toBeGreaterThan(0);
    }
  });
});
