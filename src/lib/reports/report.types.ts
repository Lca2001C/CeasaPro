export type ReportFormatCell = "money" | "int" | "qty" | "date" | "text";

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  format?: ReportFormatCell;
}

export interface ReportResult {
  title: string;
  period: { from: Date; to: Date };
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  generatedAt: Date;
}

export const REPORT_TYPES = [
  // Basicos
  "VENDAS",
  "COMPRAS",
  "FIADO",
  "DESPESAS",
  "CONTAS_PAGAS",
  "ESTOQUE",
  // Avancados (Fase 2)
  "LUCRO_PRODUTO",
  "LUCRO_FORNECEDOR",
  "MAIS_VENDIDOS",
  "PRODUTOS_PREJUIZO",
  "ESTOQUE_PARADO",
  "CAIXAS_PAPELAO",
  "INADIMPLENTES",
  "FORNECEDORES",
  "FLUXO_CAIXA",
  "CAIXAS_PLASTICAS",
  "HIGIENIZACAO",
  "EMBALAGENS",
] as const;
export type ReportKind = (typeof REPORT_TYPES)[number];

/** Relatórios inclusos no núcleo (sempre disponíveis). */
export const BASIC_REPORTS: ReportKind[] = [
  "VENDAS",
  "COMPRAS",
  "FIADO",
  "DESPESAS",
  "CONTAS_PAGAS",
  "ESTOQUE",
];

/**
 * Relatórios do módulo opcional `relatorios_avancados`.
 *
 * Mantida apenas para leitura/documentação: quem decide é `isAdvancedReport`,
 * pela AUSÊNCIA em `BASIC_REPORTS`. Ver o comentário lá.
 */
export const ADVANCED_REPORTS: ReportKind[] = REPORT_TYPES.filter(
  (t) => !BASIC_REPORTS.includes(t),
);

/**
 * É relatório do módulo pago?
 *
 * Decide pela ausência em `BASIC_REPORTS`, e não pela presença numa lista de
 * avançados — a diferença é o que acontece com quem esquece de classificar.
 *
 * Era `ADVANCED_REPORTS.includes(kind)`, fail-OPEN, e quatro relatórios nunca
 * foram para a lista: "Lucro por fornecedor", "Produtos com prejuízo",
 * "Estoque parado" e "Total de caixas de papelão". Os dois gates dependem só
 * desta função, então eles apareciam em /relatorios para quem está no plano
 * básico E a rota de exportação gerava o Excel/PDF sem pedir módulo — furo de
 * receita, e no caso de CAIXAS_PAPELAO entrega de dados de `packaging_sales`,
 * que é de outro módulo.
 *
 * Nesta direção, esquecer de classificar um relatório novo o deixa BLOQUEADO
 * (alguém reclama e conserta) em vez de liberado em silêncio.
 */
export function isAdvancedReport(kind: ReportKind): boolean {
  return !BASIC_REPORTS.includes(kind);
}

export const REPORT_LABELS: Record<ReportKind, string> = {
  VENDAS: "Relatório de vendas",
  COMPRAS: "Relatório de compras",
  FIADO: "Relatório de fiado",
  DESPESAS: "Relatório de despesas",
  CONTAS_PAGAS: "Contas pagas no período",
  ESTOQUE: "Relatório de estoque",
  LUCRO_PRODUTO: "Lucro por produto",
  LUCRO_FORNECEDOR: "Lucro por fornecedor",
  MAIS_VENDIDOS: "Produtos mais vendidos",
  PRODUTOS_PREJUIZO: "Produtos com prejuízo",
  ESTOQUE_PARADO: "Estoque parado",
  CAIXAS_PAPELAO: "Total de caixas de papelão",
  INADIMPLENTES: "Clientes inadimplentes",
  FORNECEDORES: "Relatório de fornecedores",
  FLUXO_CAIXA: "Fluxo de caixa",
  CAIXAS_PLASTICAS: "Caixas plásticas",
  HIGIENIZACAO: "Higienização",
  EMBALAGENS: "Venda de embalagens",
};

/**
 * Relatórios agrupados por assunto.
 *
 * Uma lista plana de 17 itens obriga a ler tudo para achar um. Em grupos de
 * 2–4, a escolha vira "primeiro o assunto, depois o relatório" — bem mais
 * rápido de varrer, ainda mais no celular.
 *
 * A lista é derivada de `REPORT_TYPES`, não digitada de novo: um relatório
 * novo que fique de fora aparece no teste de cobertura, em vez de sumir da tela.
 */
export const REPORT_GROUPS: { titulo: string; relatorios: ReportKind[] }[] = [
  {
    titulo: "Vendas e fiado",
    relatorios: ["VENDAS", "FIADO", "MAIS_VENDIDOS", "INADIMPLENTES"],
  },
  {
    titulo: "Compras e estoque",
    relatorios: ["COMPRAS", "ESTOQUE", "ESTOQUE_PARADO", "FORNECEDORES"],
  },
  {
    // "Financeiro" passou de 6 itens com a entrada de CONTAS_PAGAS, e um grupo
    // grande derrota o propósito do agrupamento (escolher de relance). A quebra
    // segue a pergunta do usuário: "o que eu pago" vs. "quanto eu ganho".
    titulo: "Contas e caixa",
    relatorios: ["DESPESAS", "CONTAS_PAGAS", "FLUXO_CAIXA"],
  },
  {
    titulo: "Lucratividade",
    relatorios: ["LUCRO_PRODUTO", "LUCRO_FORNECEDOR", "PRODUTOS_PREJUIZO"],
  },
  {
    titulo: "Caixas, higienização e embalagens",
    relatorios: ["CAIXAS_PLASTICAS", "CAIXAS_PAPELAO", "HIGIENIZACAO", "EMBALAGENS"],
  },
];
