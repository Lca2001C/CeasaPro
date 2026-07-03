import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { VendasService } from "@/lib/services/vendas.service";
import { formatBRL, formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function VendasPage() {
  const { tenantId } = await requireTenant();
  const vendas = await VendasService.list(tenantId);

  return (
    <div>
      <PageHeader
        title="Vendas"
        description="Histórico de vendas registradas."
        action={
          <Button asChild size="sm">
            <Link href="/vendas/nova">
              <Plus /> Nova venda
            </Link>
          </Button>
        }
      />

      {vendas.length === 0 ? (
        <EmptyState
          title="Nenhuma venda registrada"
          description="Toque em Nova venda para abrir a frente de caixa."
          action={
            <Button asChild>
              <Link href="/vendas/nova">
                <Plus /> Nova venda
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {vendas.map((v) => (
            <Card key={v.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{v.customerName || "Cliente"}</span>
                    <Badge variant={v.paymentMethod === "FIADO" ? "warning" : "secondary"}>
                      {PAYMENT_METHOD_LABELS[v.paymentMethod]}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(v.saleDate)} · {v.items.length} item(ns)
                  </span>
                </div>
                <span className="font-semibold tabular-nums">{formatBRL(v.totalAmount)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
