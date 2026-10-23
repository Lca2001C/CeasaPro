import type { Prisma, ReportFormat, ReportType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { toExcel } from "./excel.exporter";
import { toPdf } from "./pdf.exporter";
import type { ReportResult } from "./report.types";

/**
 * Trecho seguro de nome de arquivo a partir de um texto livre (nome de
 * cliente): sem acento, só letras, números e hífen. O nome vai no
 * `Content-Disposition`, e aspas ou quebra de linha ali quebrariam o cabeçalho.
 */
export function trechoDeNomeDeArquivo(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "cliente"
  );
}

/**
 * O PDF ou o Excel de um `ReportResult`, como resposta de download — e o
 * registro em `report_exports` (best-effort: não bloqueia o download).
 * Usado pela exportação de relatórios e pelo comprovante de venda.
 */
export async function respostaDeArquivo(args: {
  result: ReportResult;
  formato: "pdf" | "excel";
  /** Sem extensão; ela sai do formato. */
  nomeBase: string;
  registro: {
    tenantId: string;
    userId: string;
    type: ReportType;
    filters?: Prisma.InputJsonValue;
  };
}): Promise<Response> {
  const isPdf = args.formato === "pdf";
  const buffer = isPdf ? await toPdf(args.result) : await toExcel(args.result);
  const fileName = `${args.nomeBase}.${isPdf ? "pdf" : "xlsx"}`;
  const format: ReportFormat = isPdf ? "PDF" : "EXCEL";
  const contentType = isPdf
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  prisma.reportExport
    .create({
      data: {
        tenantId: args.registro.tenantId,
        userId: args.registro.userId,
        type: args.registro.type,
        format,
        status: "CONCLUIDO",
        periodStart: args.result.period.from,
        periodEnd: args.result.period.to,
        rowCount: args.result.rows.length,
        fileName,
        ...(args.registro.filters !== undefined ? { filters: args.registro.filters } : {}),
      },
    })
    .catch((e) => logger.error({ err: String(e) }, "Falha ao registrar report_export"));

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
