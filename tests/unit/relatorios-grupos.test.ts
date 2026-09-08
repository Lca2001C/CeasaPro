import { describe, it, expect } from "vitest";
import {
  REPORT_GROUPS,
  REPORT_TYPES,
  REPORT_LABELS,
  isAdvancedReport,
  BASIC_REPORTS,
  ADVANCED_REPORTS,
  type ReportKind,
} from "@/lib/reports/report.types";

/**
 * A tela de relatórios monta a lista a partir de `REPORT_GROUPS`. Se um
 * relatório novo entrar em `REPORT_TYPES` e ninguém o colocar num grupo, ele
 * simplesmente não aparece — some da UI sem erro nenhum. Este teste é a rede
 * que pega isso.
 */
describe("agrupamento dos relatórios", () => {
  const agrupados = REPORT_GROUPS.flatMap((g) => g.relatorios);

  it("todo relatório existente está em algum grupo", () => {
    const faltando = REPORT_TYPES.filter((t) => !agrupados.includes(t));
    expect(faltando).toEqual([]);
  });

  it("nenhum relatório aparece em dois grupos", () => {
    const vistos = new Set<ReportKind>();
    const duplicados: ReportKind[] = [];
    for (const t of agrupados) {
      if (vistos.has(t)) duplicados.push(t);
      vistos.add(t);
    }
    expect(duplicados).toEqual([]);
  });

  it("nenhum grupo é grande demais para escolher de relance", () => {
    for (const g of REPORT_GROUPS) {
      expect(g.relatorios.length).toBeGreaterThan(0);
      expect(g.relatorios.length).toBeLessThanOrEqual(5);
    }
  });

  it("todo grupo tem ao menos um relatório do plano básico", () => {
    // Senão o grupo abriria só com o cartão de "disponível em outro plano",
    // e quem está no plano básico veria uma seção que nunca serve para nada.
    for (const g of REPORT_GROUPS) {
      const temBasico = g.relatorios.some((t) => !isAdvancedReport(t));
      expect(temBasico, `grupo "${g.titulo}" só tem relatórios avançados`).toBe(true);
    }
  });
});

describe("rótulos dos relatórios", () => {
  it("todo relatório tem rótulo", () => {
    for (const t of REPORT_TYPES) {
      expect(REPORT_LABELS[t], `sem rótulo: ${t}`).toBeTruthy();
    }
  });

  it("os rótulos estão acentuados corretamente", () => {
    // Estavam sem acento ("Relatorio", "plasticas", "prejuizo") — o sistema é
    // em português e o texto aparece impresso no PDF que vai para o cliente.
    expect(REPORT_LABELS.VENDAS).toBe("Relatório de vendas");
    expect(REPORT_LABELS.CAIXAS_PLASTICAS).toBe("Caixas plásticas");
    expect(REPORT_LABELS.PRODUTOS_PREJUIZO).toBe("Produtos com prejuízo");
    expect(REPORT_LABELS.HIGIENIZACAO).toBe("Higienização");
    expect(REPORT_LABELS.CAIXAS_PAPELAO).toBe("Total de caixas de papelão");
  });
});

/**
 * Todo relatório é básico OU avançado, e a dúvida bloqueia.
 *
 * `isAdvancedReport` era fail-OPEN (`ADVANCED_REPORTS.includes`), e quatro
 * relatórios nunca foram classificados: "Lucro por fornecedor", "Produtos com
 * prejuízo", "Estoque parado" e "Total de caixas de papelão". Os dois gates
 * — a lista de /relatorios e a rota de exportação — dependem só dessa função,
 * então eles ficavam liberados em qualquer plano, e CAIXAS_PAPELAO ainda
 * entregava dados de `packaging_sales`, que é de outro módulo.
 */
describe("classificação por plano", () => {
  it("nenhum relatório fica sem classificação", () => {
    const semClasse = REPORT_TYPES.filter(
      (t) => !BASIC_REPORTS.includes(t) && !ADVANCED_REPORTS.includes(t),
    );
    expect(semClasse).toEqual([]);
  });

  it("nenhum relatório está nas duas listas", () => {
    const nasDuas = REPORT_TYPES.filter(
      (t) => BASIC_REPORTS.includes(t) && ADVANCED_REPORTS.includes(t),
    );
    expect(nasDuas).toEqual([]);
  });

  it("os quatro que vazavam agora são pagos", () => {
    for (const t of [
      "LUCRO_FORNECEDOR",
      "PRODUTOS_PREJUIZO",
      "ESTOQUE_PARADO",
      "CAIXAS_PAPELAO",
    ] as ReportKind[]) {
      expect(isAdvancedReport(t), `${t} deveria exigir o módulo pago`).toBe(true);
    }
  });

  it("os do núcleo continuam livres", () => {
    for (const t of BASIC_REPORTS) {
      expect(isAdvancedReport(t), `${t} é do núcleo e não pode ser bloqueado`).toBe(false);
    }
  });

  it("a decisão é pela AUSÊNCIA no núcleo — esquecer de classificar bloqueia", () => {
    // Um relatório novo que ninguém classificou não pode nascer liberado.
    expect(isAdvancedReport("RELATORIO_QUE_NAO_EXISTE" as ReportKind)).toBe(true);
  });
});
