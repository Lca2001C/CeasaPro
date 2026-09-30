import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { formatDate } from "@/lib/format";
import { civilParts } from "@/lib/tz";
import type { ReportColumn, ReportResult } from "./report.types";

/**
 * Formatos numéricos da planilha. O Excel aplica o separador do idioma de quem
 * abre, então "#,##0.00" aparece como "1.234,56" num Excel em português.
 */
const NUM_FMT = {
  money: '"R$" #,##0.00;-"R$" #,##0.00',
  int: "0",
  date: "dd/mm/yyyy",
  /** Formato "Texto": o Excel não interpreta como fórmula nem ao reeditar a célula. */
  text: "@",
} as const;

type ValorCelula = { value: ExcelJS.CellValue; numFmt?: string };

/** Número de verdade a partir do que o relatório entrega (Decimal, number ou texto numérico). */
function comoNumero(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

/**
 * A data CIVIL brasileira do instante, como meia-noite UTC.
 *
 * O Excel não tem fuso: grava o relógio que recebe. `ExcelJS` usa os campos UTC
 * do `Date`, então a venda das 22h (01h UTC do dia seguinte) sairia um dia
 * adiantada. A tela e o PDF mostram o dia no fuso do app; a planilha também.
 */
function dataCivil(value: unknown): Date | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const d = new Date(value as string | Date);
  if (Number.isNaN(d.getTime())) return null;
  const c = civilParts(d);
  return new Date(Date.UTC(c.year, c.month - 1, c.day));
}

function texto(value: unknown): ValorCelula {
  // Sem apóstrofo no valor. O `ExcelJS` grava string como string (nunca como
  // fórmula), e o formato "Texto" (`@`) impede que "=HYPERLINK(...)" vire
  // fórmula quando alguém reedita a célula. O apóstrofo que se colocava antes
  // era gravado como parte do conteúdo — e o Excel o EXIBIA: "'-R$ 12,00",
  // "'-" em toda célula vazia.
  return { value: String(value), numFmt: NUM_FMT.text };
}

/**
 * Converte o valor do relatório para a célula da planilha.
 *
 * Dinheiro, quantidade e inteiro vão como NÚMERO e data como DATA: antes tudo
 * saía como texto formatado ("R$ 1.234,56"), e o contador não conseguia usar
 * SOMA nem filtrar por data. Vazio vai vazio (não "-"). O que não couber no
 * formato da coluna (o rótulo "TOTAL" numa coluna de data) cai para texto.
 */
export function celulaExcel(value: unknown, format?: ReportColumn["format"]): ValorCelula {
  if (value === null || value === undefined || value === "") return { value: null };
  switch (format) {
    case "money": {
      const n = comoNumero(value);
      return n === null ? texto(value) : { value: n, numFmt: NUM_FMT.money };
    }
    case "qty": {
      // Formato "Geral": mostra as casas que a quantidade tem (12,5 / 3,125 / 10)
      // sem zeros à direita nem vírgula solta.
      const n = comoNumero(value);
      return n === null ? texto(value) : { value: n };
    }
    case "int": {
      const n = comoNumero(value);
      return n === null ? texto(value) : { value: n, numFmt: NUM_FMT.int };
    }
    case "date": {
      const d = dataCivil(value);
      return d === null ? texto(value) : { value: d, numFmt: NUM_FMT.date };
    }
    default:
      return texto(value);
  }
}

function escrever(row: ExcelJS.Row, celulas: ValorCelula[]) {
  celulas.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c.value;
    if (c.numFmt) cell.numFmt = c.numFmt;
  });
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
    escrever(
      ws.addRow([]),
      r.columns.map((c) => celulaExcel(row[c.key], c.format)),
    );
  }

  if (r.totals) {
    const totalsRow = ws.addRow([]);
    escrever(
      totalsRow,
      r.columns.map((c) =>
        r.totals![c.key] !== undefined ? celulaExcel(r.totals![c.key], c.format) : { value: null },
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
