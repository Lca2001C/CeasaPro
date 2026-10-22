import { notFound, redirect } from "next/navigation";
import { FileBarChart } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/plan/modules";
import { resolvePeriod, type PeriodPreset } from "@/lib/dates";
import { buildReport } from "@/lib/reports/report.service";
import { REPORT_TYPES, modulosDoRelatorio, type ReportKind } from "@/lib/reports/report.types";
import { formatCell } from "@/lib/reports/format-cell";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableFooter,
} from "@/components/ui/table";
import { EmptyState } from "@/components/data/empty-state";
import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { ReportToolbar } from "./_components/report-toolbar";

export const dynamic = "force-dynamic";

export default async function RelatorioViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<{
    preset?: string;
    from?: string;
    to?: string;
    campo?: string;
    agrupar?: string;
  }>;
}) {
  const { tipo } = await params;
  const sp = await searchParams;
  const kind = tipo.toUpperCase() as ReportKind;
  if (!REPORT_TYPES.includes(kind)) notFound();

  const { tenantId, session } = await requireTenant();
  // Relatórios avançados exigem o pacote no plano, e os de módulo opcional, o
  // módulo dono dos dados.
  const faltando = modulosDoRelatorio(kind).find((m) => !isModuleEnabled(session.modules, m));
  if (faltando) redirect(`/plano?bloqueado=${faltando}`);
  const period = resolvePeriod({
    preset: (sp.preset as PeriodPreset) ?? "mes",
    from: sp.from,
    to: sp.to,
  });
  // `campo` e `agrupar` só têm efeito nos relatórios de despesa; nos outros o
  // buildReport simplesmente os ignora.
  const campo =
    sp.campo === "paidDate" || sp.campo === "createdAt" || sp.campo === "dueDate"
      ? sp.campo
      : undefined;
  const report = await buildReport(kind, {
    tenantId,
    from: period.from,
    to: period.to,
    toVencimento: period.toVencimento,
    dateField: campo,
    agruparPorCategoria: sp.agrupar === "categoria",
    modules: session.modules,
  });

  return (
    <div>
      <PageHeader
        title={report.title}
        description={`Período: ${formatDate(report.period.from)} a ${formatDate(report.period.to)}`}
      />

      <div className="flex flex-col gap-5">
        <ReportToolbar
          kind={kind.toLowerCase()}
          mostrarOpcoesDeDespesa={kind === "DESPESAS" || kind === "CONTAS_PAGAS"}
          permiteEscolherData={kind === "DESPESAS"}
        />

        {report.rows.length === 0 ? (
          <EmptyState
            icon={<FileBarChart />}
            title="Nenhum dado no período"
            description="Ajuste o período no seletor acima."
          />
        ) : (
          /*
            Na impressão o cartão some: papel não tem sombra nem fundo de tema
            (no tema escuro, o fundo do cartão sairia como um bloco escuro na
            folha), e a tabela ocupa a largura toda.
          */
          <Card className="overflow-hidden print:overflow-visible print:rounded-none print:border-0 print:bg-transparent print:text-inherit print:shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  {report.columns.map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn(
                        "whitespace-nowrap first:pl-4 last:pr-4",
                        c.align === "right" && "text-right",
                      )}
                    >
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row, i) => (
                  <TableRow key={i}>
                    {report.columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(
                          "first:pl-4 last:pr-4",
                          c.align === "right" && "text-right tabular-nums",
                        )}
                      >
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
                      <TableCell
                        key={c.key}
                        className={cn(
                          "font-bold first:pl-4 last:pr-4",
                          c.align === "right" && "text-right tabular-nums",
                        )}
                      >
                        {report.totals![c.key] !== undefined
                          ? formatCell(report.totals![c.key], c.format)
                          : ""}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
