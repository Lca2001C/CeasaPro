import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { DespesasService } from "@/lib/services/despesas.service";
import { excluirDespesa } from "@/actions/despesas.actions";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { formatBRL, formatDate } from "@/lib/format";
import { EXPENSE_TYPE_LABELS } from "@/lib/labels";
import { startOfDayTz } from "@/lib/tz";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/crud/delete-button";

export const dynamic = "force-dynamic";

const FILTROS = [
  { value: "PENDENTE", label: "Pendentes" },
  { value: "PAGO", label: "Pagas" },
  { value: "TODAS", label: "Todas" },
] as const;

export default async function DespesasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const filtro = FILTROS.some((f) => f.value === rawStatus)
    ? (rawStatus as (typeof FILTROS)[number]["value"])
    : "PENDENTE";

  const { tenantId } = await requireTenant();
  const todas = await DespesasService.list(tenantId);

  // Os totais somam TODAS as despesas, não só as filtradas: os cards são o
  // retrato do mês: filtrar a lista não pode mudar quanto se deve no total.
  const totais = FinancialCalc.totaisDespesas(
    todas.map((d) => ({ type: d.type, amount: d.amount })),
  );

  const despesas = todas
    .filter((d) => filtro === "TODAS" || d.status === filtro)
    // Pendentes por vencimento, o que vence primeiro no topo — sem data vai
    // para o fim, porque não tem prazo correndo.
    .sort((a, b) => {
      if (filtro === "PAGO") return 0;
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

  const hoje = startOfDayTz(new Date());
  const vencida = (d: (typeof despesas)[number]) =>
    d.status !== "PAGO" && d.dueDate !== null && d.dueDate < hoje;

  return (
    <div>
      <PageHeader
        title="Despesas"
        description="Controle suas contas fixas e variáveis."
        action={
          <Button asChild size="sm">
            <Link href="/despesas/nova">
              <Plus /> Nova
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="Fixas" value={formatBRL(totais.fixas)} />
        <StatCard label="Variáveis" value={formatBRL(totais.variaveis)} />
        <StatCard label="Total" value={formatBRL(totais.geral)} tone="destructive" />
      </div>

      <div className="mb-4 flex gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={filtro === f.value ? "default" : "outline"}
          >
            <Link href={`/despesas?status=${f.value}`}>{f.label}</Link>
          </Button>
        ))}
      </div>

      {despesas.length === 0 ? (
        <EmptyState
          title={
            filtro === "PAGO"
              ? "Nenhuma despesa paga"
              : filtro === "PENDENTE"
                ? "Nenhuma conta pendente"
                : "Nenhuma despesa cadastrada"
          }
          description="Toque em Nova para lançar sua primeira despesa."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {despesas.map((d) => (
            <Card
              key={d.id}
              className={cn(
                "flex items-center justify-between p-3",
                vencida(d) && "border-destructive/50 bg-destructive/5",
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{d.description}</span>
                  {vencida(d) ? (
                    <Badge variant="destructive">Vencida</Badge>
                  ) : (
                    <Badge variant={d.status === "PAGO" ? "success" : "warning"}>
                      {d.status === "PAGO" ? "Pago" : "Pendente"}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {EXPENSE_TYPE_LABELS[d.type]}
                  {d.category ? ` · ${d.category.name}` : ""}
                  {d.dueDate ? ` · vence ${formatDate(d.dueDate)}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-semibold tabular-nums">{formatBRL(d.amount)}</span>
                <Button asChild variant="ghost" size="icon" aria-label="Editar">
                  <Link href={`/despesas/${d.id}`}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                <DeleteButton
                  action={excluirDespesa}
                  id={d.id}
                  entityLabel={`a despesa ${d.description}`}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
