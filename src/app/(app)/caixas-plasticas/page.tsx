import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { CaixasService } from "@/lib/services/caixas.service";
import { formatDate } from "@/lib/format";
import { CRATE_MOVEMENT_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const BADGE_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  ENTRADA: "success",
  SAIDA: "warning",
  RETORNO: "secondary",
  QUEBRA: "destructive",
};

export default async function CaixasPlasticasPage() {
  const { tenantId } = await requireTenant();
  const [saldo, movimentos] = await Promise.all([
    CaixasService.getSaldo(tenantId),
    CaixasService.list(tenantId),
  ]);

  return (
    <div>
      <PageHeader
        title="Caixas plásticas"
        description="Controle de entrada, saída, retorno e perdas."
        action={
          <Button asChild size="sm">
            <Link href="/caixas-plasticas/novo">
              <Plus /> Movimentar
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="Vazias no estoque" value={String(saldo.vazias)} />
        <StatCard label="Com clientes" value={String(saldo.comClientes)} tone="warning" />
        <StatCard label="Perdidas/quebradas" value={String(saldo.perdidas)} tone="destructive" />
      </div>

      {movimentos.length === 0 ? (
        <EmptyState
          title="Nenhuma movimentação de caixas"
          description="Registre a primeira entrada de caixas plásticas."
          action={
            <Button asChild>
              <Link href="/caixas-plasticas/novo">
                <Plus /> Movimentar caixas
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {movimentos.map((m) => (
            <Card key={m.id} className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={BADGE_VARIANT[m.type] ?? "secondary"}>
                    {CRATE_MOVEMENT_LABELS[m.type]}
                  </Badge>
                  <span className="truncate text-sm">
                    {m.customerName ?? m.supplierName ?? ""}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDate(m.movementDate)}
                  {m.brokenQty > 0 ? ` · ${m.brokenQty} quebrada(s) na chegada` : ""}
                  {m.notes ? ` · ${m.notes}` : ""}
                </span>
              </div>
              <span className="font-semibold tabular-nums">{m.quantity}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
