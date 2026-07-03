import { formatBRL, formatDate, formatQty } from "@/lib/format";
import type { ReportFormatCell } from "./report.types";

/** Formata uma célula do relatório conforme o tipo da coluna (usado por PDF, Excel e tela). */
export function formatCell(value: unknown, format?: ReportFormatCell): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "money":
      return formatBRL(value as number);
    case "qty":
      return formatQty(value as number);
    case "date":
      return formatDate(value as Date);
    case "int":
      return String(value);
    default:
      return String(value);
  }
}
