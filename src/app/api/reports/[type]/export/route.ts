import { z } from "zod";
import { withTenantRoute } from "@/lib/http/with-route";
import { NotFoundError } from "@/lib/http/app-error";
import { requireModule } from "@/lib/plan/modules";
import { resolvePeriod, type PeriodPreset } from "@/lib/dates";
import { isoDateTz } from "@/lib/tz";
import { buildReport } from "@/lib/reports/report.service";
import {
  REPORT_TYPES,
  modulosDoRelatorio,
  presetDoRelatorio,
  type ReportKind,
} from "@/lib/reports/report.types";
import { respostaDeArquivo, trechoDeNomeDeArquivo } from "@/lib/reports/arquivo-exportado";
import type { ReportType } from "@prisma/client";

export const runtime = "nodejs";
// PDF/Excel de período longo passa dos ~10 s padrão da função.
export const maxDuration = 60;

const querySchema = z.object({
  preset: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(["excel", "pdf"]).default("excel"),
  // Só o relatório de despesas usa: por qual data filtrar e se agrupa por categoria.
  campo: z.enum(["dueDate", "paidDate", "createdAt"]).optional(),
  agrupar: z.enum(["categoria"]).optional(),
  // Só o relatório de vendas usa: o extrato de um cliente (pelo nome).
  cliente: z.string().trim().max(120).optional(),
});

export const GET = withTenantRoute({
  schema: querySchema,
  source: "query",
  handler: async (input, ctx) => {
    const parts = new URL(ctx.req.url).pathname.split("/").filter(Boolean);
    const kind = (parts[2] ?? "").toUpperCase() as ReportKind; // /api/reports/<kind>/export
    if (!REPORT_TYPES.includes(kind)) throw new NotFoundError("Relatorio invalido");

    // Relatórios avançados exigem o pacote no plano, e os de módulo opcional,
    // o módulo dono dos dados (barreira de servidor).
    for (const modulo of modulosDoRelatorio(kind)) requireModule(ctx.session.modules, modulo);

    const cliente = kind === "VENDAS" && input.cliente ? input.cliente : undefined;
    const period = resolvePeriod({
      preset: (presetDoRelatorio(kind, input.preset, cliente) as PeriodPreset) ?? "mes",
      from: input.from,
      to: input.to,
    });
    const result = await buildReport(kind, {
      tenantId: ctx.tenantId,
      from: period.from,
      to: period.to,
      toVencimento: period.toVencimento,
      dateField: input.campo,
      agruparPorCategoria: input.agrupar === "categoria",
      modules: ctx.session.modules,
      cliente,
    });

    // Dia civil do início do período — e o período é sempre válido: data
    // impossível no filtro cai no preset padrão em `resolvePeriod` (era 500).
    const nomeBase = cliente
      ? `${kind.toLowerCase()}-${trechoDeNomeDeArquivo(cliente)}-${isoDateTz(period.from)}`
      : `${kind.toLowerCase()}-${isoDateTz(period.from)}`;
    return respostaDeArquivo({
      result,
      formato: input.format,
      nomeBase,
      registro: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        type: kind as ReportType,
        ...(cliente ? { filters: { cliente } } : {}),
      },
    });
  },
});
