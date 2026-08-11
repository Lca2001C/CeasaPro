import { z } from "zod";
import { withTenantRoute } from "@/lib/http/with-route";
import { NotFoundError } from "@/lib/http/app-error";
import { requireModule } from "@/lib/plan/modules";
import { resolvePeriod, type PeriodPreset } from "@/lib/dates";
import { buildReport } from "@/lib/reports/report.service";
import { toExcel } from "@/lib/reports/excel.exporter";
import { toPdf } from "@/lib/reports/pdf.exporter";
import { REPORT_TYPES, isAdvancedReport, type ReportKind } from "@/lib/reports/report.types";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import type { ReportFormat, ReportType } from "@prisma/client";

export const runtime = "nodejs";

const querySchema = z.object({
  preset: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(["excel", "pdf"]).default("excel"),
});

export const GET = withTenantRoute({
  schema: querySchema,
  source: "query",
  handler: async (input, ctx) => {
    const parts = new URL(ctx.req.url).pathname.split("/").filter(Boolean);
    const kind = (parts[2] ?? "").toUpperCase() as ReportKind; // /api/reports/<kind>/export
    if (!REPORT_TYPES.includes(kind)) throw new NotFoundError("Relatorio invalido");

    // Relatórios avançados exigem o módulo no plano (barreira de servidor).
    if (isAdvancedReport(kind)) requireModule(ctx.session.modules, "relatorios_avancados");

    const period = resolvePeriod({
      preset: (input.preset as PeriodPreset) ?? "mes",
      from: input.from,
      to: input.to,
    });
    const result = await buildReport(kind, {
      tenantId: ctx.tenantId,
      from: period.from,
      to: period.to,
    });
    const isPdf = input.format === "pdf";
    const buffer = isPdf ? await toPdf(result) : await toExcel(result);
    const extension = isPdf ? "pdf" : "xlsx";
    const fileName = `${kind.toLowerCase()}-${period.from.toISOString().slice(0, 10)}.${extension}`;
    const format: ReportFormat = isPdf ? "PDF" : "EXCEL";
    const contentType = isPdf
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    // Historico de exportacoes (best-effort: nao bloqueia o download).
    prisma.reportExport
      .create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          type: kind as ReportType,
          format,
          status: "CONCLUIDO",
          periodStart: period.from,
          periodEnd: period.to,
          rowCount: result.rows.length,
          fileName,
        },
      })
      .catch((e) => logger.error({ err: String(e) }, "Falha ao registrar report_export"));

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  },
});
