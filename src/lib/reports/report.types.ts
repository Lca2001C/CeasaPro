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
  "VENDAS",
  "COMPRAS",
  "FIADO",
  "DESPESAS",
  "ESTOQUE",
] as const;
export type ReportKind = (typeof REPORT_TYPES)[number];

export const REPORT_LABELS: Record<ReportKind, string> = {
  VENDAS: "Relatório de vendas",
  COMPRAS: "Relatório de compras",
  FIADO: "Relatório de fiado",
  DESPESAS: "Relatório de despesas",
  ESTOQUE: "Relatório de estoque",
};
