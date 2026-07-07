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
  // Básicos
  "VENDAS",
  "COMPRAS",
  "FIADO",
  "DESPESAS",
  "ESTOQUE",
  // Avançados (Fase 2)
  "LUCRO_PRODUTO",
  "MAIS_VENDIDOS",
  "INADIMPLENTES",
  "FORNECEDORES",
  "FLUXO_CAIXA",
  "CAIXAS_PLASTICAS",
  "HIGIENIZACAO",
  "EMBALAGENS",
] as const;
export type ReportKind = (typeof REPORT_TYPES)[number];

export const REPORT_LABELS: Record<ReportKind, string> = {
  VENDAS: "Relatório de vendas",
  COMPRAS: "Relatório de compras",
  FIADO: "Relatório de fiado",
  DESPESAS: "Relatório de despesas",
  ESTOQUE: "Relatório de estoque",
  LUCRO_PRODUTO: "Lucro por produto",
  MAIS_VENDIDOS: "Produtos mais vendidos",
  INADIMPLENTES: "Clientes inadimplentes",
  FORNECEDORES: "Relatório de fornecedores",
  FLUXO_CAIXA: "Fluxo de caixa",
  CAIXAS_PLASTICAS: "Caixas plásticas",
  HIGIENIZACAO: "Higienização",
  EMBALAGENS: "Venda de embalagens",
};
