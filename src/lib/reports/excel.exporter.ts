import ExcelJS from "exceljs";
import { formatDate } from "@/lib/format";
import { formatCell, spreadsheetSafe } from "./format-cell";
import type { ReportResult } from "./report.types";

/** Formata a célula e neutraliza fórmulas (CSV/Excel injection). */
function cell(value: unknown, format?: ReportResult["columns"][number]["format"]) {
  return spreadsheetSafe(formatCell(value, format));
}

/** Gera um arquivo .xlsx real a partir de um ReportResult. */
export async function toExcel(r: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CeasaPro";
  const ws = wb.addWorksheet("Relatório");

  const titleRow = ws.addRow([r.title]);
  titleRow.font = { bold: true, size: 14 };
  ws.addRow([`Período: ${formatDate(r.period.from)} a ${formatDate(r.period.to)}`]);
  ws.addRow([`Gerado em: ${formatDate(r.generatedAt)}`]);
  ws.addRow([]);

  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  });

  for (const row of r.rows) {
    ws.addRow(r.columns.map((c) => cell(row[c.key], c.format)));
  }

  if (r.totals) {
    const totalsRow = ws.addRow(
      r.columns.map((c) =>
        r.totals![c.key] !== undefined ? cell(r.totals![c.key], c.format) : "",
      ),
    );
    totalsRow.font = { bold: true };
  }

  r.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(14, c.label.length + 4);
    if (c.align === "right") ws.getColumn(i + 1).alignment = { horizontal: "right" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
