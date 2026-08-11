import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/plan/modules";
import { resolvePeriod, type PeriodPreset } from "@/lib/dates";
import { buildReport } from "@/lib/reports/report.service";
import { REPORT_TYPES, isAdvancedReport, type ReportKind } from "@/lib/reports/report.types";
import { formatCell } from "@/lib/reports/format-cell";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter } from "@/components/ui/table";
import { EmptyState } from "@/components/data/empty-state";
import { ReportToolbar } from "./_components/report-toolbar";

export const dynamic = "force-dynamic";

export default async function RelatorioViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const { tipo } = await params;
  const sp = await searchParams;
  const kind = tipo.toUpperCase() as ReportKind;
  if (!REPORT_TYPES.includes(kind)) notFound();

  const { tenantId, session } = await requireTenant();
  // Relatórios avançados exigem o módulo no plano.
  if (isAdvancedReport(kind) && !isModuleEnabled(session.modules, "relatorios_avancados")) {
    redirect("/plano?bloqueado=relatorios_avancados");
  }
  const period = resolvePeriod({
    preset: (sp.preset as PeriodPreset) ?? "mes",
    from: sp.from,
    to: sp.to,
  });
  const report = await buildReport(kind, { tenantId, from: period.from, to: period.to });

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-xl font-bold">{report.title}</h1>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Periodo: {formatDate(period.from)} a {formatDate(period.to)}
      </p>

      <ReportToolbar kind={kind.toLowerCase()} />

      {report.rows.length === 0 ? (
        <EmptyState title="Nenhum dado no periodo" description="Ajuste o periodo no seletor acima." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {report.columns.map((c) => (
                <TableHead key={c.key} className={cn(c.align === "right" && "text-right")}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row, i) => (
              <TableRow key={i}>
                {report.columns.map((c) => (
                  <TableCell key={c.key} className={cn(c.align === "right" && "text-right tabular-nums")}>
                    {formatCell(row[c.key], c.format)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {report.totals && (
            <TableFooter>
              <TableRow>
                {report.columns.map((c) => (
                  <TableCell key={c.key} className={cn(c.align === "right" && "text-right tabular-nums")}>
                    {report.totals![c.key] !== undefined ? formatCell(report.totals![c.key], c.format) : ""}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      )}
    </div>
  );
}
