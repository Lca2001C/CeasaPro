import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { DespesasService } from "@/lib/services/despesas.service";
import { excluirDespesa } from "@/actions/despesas.actions";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { formatBRL, formatDate } from "@/lib/format";
import { EXPENSE_TYPE_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/crud/delete-button";

export const dynamic = "force-dynamic";

export default async function DespesasPage() {
  const { tenantId } = await requireTenant();
  const despesas = await DespesasService.list(tenantId);
  const totais = FinancialCalc.totaisDespesas(
    despesas.map((d) => ({ type: d.type, amount: d.amount })),
  );

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

      {despesas.length === 0 ? (
        <EmptyState
          title="Nenhuma despesa cadastrada"
          description="Toque em Nova para lançar sua primeira despesa."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {despesas.map((d) => (
            <Card key={d.id} className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{d.description}</span>
                  <Badge variant={d.status === "PAGO" ? "success" : "warning"}>
                    {d.status === "PAGO" ? "Pago" : "Pendente"}
                  </Badge>
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
