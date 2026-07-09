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

export const REPORT_LABELS: Record<ReportKind, string> = {
  VENDAS: "Relatorio de vendas",
  COMPRAS: "Relatorio de compras",
  FIADO: "Relatorio de fiado",
  DESPESAS: "Relatorio de despesas",
  ESTOQUE: "Relatorio de estoque",
  LUCRO_PRODUTO: "Lucro por produto",
  LUCRO_FORNECEDOR: "Lucro por fornecedor",
  MAIS_VENDIDOS: "Produtos mais vendidos",
  PRODUTOS_PREJUIZO: "Produtos com prejuizo",
  ESTOQUE_PARADO: "Estoque parado",
  CAIXAS_PAPELAO: "Total de caixas de papelao",
  INADIMPLENTES: "Clientes inadimplentes",
  FORNECEDORES: "Relatorio de fornecedores",
  FLUXO_CAIXA: "Fluxo de caixa",
  CAIXAS_PLASTICAS: "Caixas plasticas",
  HIGIENIZACAO: "Higienizacao",
  EMBALAGENS: "Venda de embalagens",
};
