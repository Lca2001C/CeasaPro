import { formatBRL, formatDate, formatQty } from "@/lib/format";
import type { ReportFormatCell } from "./report.types";

/**
 * Formata uma celula do relatorio conforme o tipo da coluna (usado por PDF, Excel e tela).
 * Defensivo: se o valor nao couber no formato (ex.: rotulo "TOTAL" numa coluna de data),
 * cai para texto em vez de lancar erro.
 */
export function formatCell(value: unknown, format?: ReportFormatCell): string {
  if (value === null || value === undefined || value === "") return "-";
  try {
    switch (format) {
      case "money":
        return formatBRL(value as number);
      case "qty":
        return formatQty(value as number);
      case "date": {
        const d = new Date(value as string | Date);
        if (Number.isNaN(d.getTime())) return String(value);
        return formatDate(d);
      }
      case "int":
        return String(value);
      default:
        return String(value);
    }
  } catch {
    return String(value);
  }
}
