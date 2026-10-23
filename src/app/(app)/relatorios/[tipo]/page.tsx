import { notFound, redirect } from "next/navigation";
import { FileBarChart } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/plan/modules";
import { resolvePeriod, type PeriodPreset } from "@/lib/dates";
import { buildReport } from "@/lib/reports/report.service";
import {
  REPORT_TYPES,
  modulosDoRelatorio,
  presetDoRelatorio,
  type ReportKind,
} from "@/lib/reports/report.types";
import { vendasDoCliente } from "@/lib/reports/vendas-do-cliente";
import { ClientesService, chaveDoCliente } from "@/lib/services/clientes.service";
import { BotoesDeExportacao } from "@/components/relatorios/botoes-de-exportacao";
import { formatCell } from "@/lib/reports/format-cell";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
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
    cliente?: string;
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
  // Filtro de cliente: só o relatório de vendas (vira o extrato do cliente).
  const cliente = kind === "VENDAS" && sp.cliente?.trim() ? sp.cliente.trim() : undefined;
  const period = resolvePeriod({
    preset: (presetDoRelatorio(kind, sp.preset, cliente) as PeriodPreset) ?? "mes",
    from: sp.from,
    to: sp.to,
  });
  // `campo` e `agrupar` só têm efeito nos relatórios de despesa; nos outros o
  // buildReport simplesmente os ignora.
  const campo =
    sp.campo === "paidDate" || sp.campo === "createdAt" || sp.campo === "dueDate"
      ? sp.campo
      : undefined;
  const [report, clientes, vendasDoFiltro] = await Promise.all([
    buildReport(kind, {
      tenantId,
      from: period.from,
      to: period.to,
      toVencimento: period.toVencimento,
      dateField: campo,
      agruparPorCategoria: sp.agrupar === "categoria",
      modules: session.modules,
      cliente,
    }),
    kind === "VENDAS" ? ClientesService.list(tenantId) : null,
    // As vendas do extrato, para o comprovante de cada uma.
    cliente ? vendasDoCliente(tenantId, cliente, period.from, period.to) : null,
  ]);
  // Ordem alfabética no seletor; o cliente da URL entra mesmo fora da lista
  // (ela tem teto de 500), senão o seletor mostraria "Todos" filtrando um só.
  const opcoesDeCliente = clientes
    ?.map((c) => ({ chave: c.chave, nome: c.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (opcoesDeCliente && cliente && !opcoesDeCliente.some((c) => c.chave === chaveDoCliente(cliente))) {
    opcoesDeCliente.unshift({ chave: chaveDoCliente(cliente), nome: cliente });
  }

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
          clientes={opcoesDeCliente}
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

        {/* Comprovante de cada venda do extrato (PDF ou Excel). */}
        {vendasDoFiltro && vendasDoFiltro.length > 0 && (
          <section className="no-print flex flex-col gap-2">
            <h2 className="px-1 text-sm font-semibold text-muted-foreground">
              Comprovante de cada venda
            </h2>
            {vendasDoFiltro.map((v) => (
              <Card key={v.id} className="flex items-center justify-between gap-3 p-3">
                <span className="min-w-0 text-sm">
                  <span className="block font-medium">{formatDateTime(v.saleDate)}</span>
                  <span className="block text-muted-foreground">
                    {v.items.length} item(ns) · {formatBRL(v.totalAmount)}
                  </span>
                </span>
                <BotoesDeExportacao
                  urlBase={`/api/vendas/${v.id}/comprovante`}
                  rotulo={`comprovante da venda de ${formatDateTime(v.saleDate)}`}
                />
              </Card>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
