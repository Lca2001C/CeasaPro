import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { FiadoService } from "@/lib/services/fiado.service";
import { formatBRL, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function FiadoPage() {
  const { tenantId } = await requireTenant();
  const { contas, totalGeral } = await FiadoService.listOpen(tenantId);

  return (
    <div>
      <PageHeader title="Fiado" description="Contas a receber dos clientes." />

      <div className="mb-4">
        <StatCard label="Total a receber" value={formatBRL(totalGeral)} tone="warning" />
      </div>

      {contas.length === 0 ? (
        <EmptyState
          title="Nenhuma conta em aberto"
          description="Vendas na forma Fiado aparecem aqui para você controlar o recebimento."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {contas.map((c) => (
            <Link key={c.id} href={`/fiado/${c.id}`}>
              <Card className="flex items-center justify-between p-3 hover:bg-accent/40">
                <div className="min-w-0">
                  <span className="truncate font-medium">{c.customerName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.dueDate ? `Vence ${formatDate(c.dueDate)}` : "Sem vencimento"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span className="block font-semibold tabular-nums text-warning">
                      {formatBRL(c.saldo)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      de {formatBRL(c.totalAmount)}
                    </span>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
