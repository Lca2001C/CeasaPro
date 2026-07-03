import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { ComprasService } from "@/lib/services/compras.service";
import { formatBRL, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ComprasPage() {
  const { tenantId } = await requireTenant();
  const compras = await ComprasService.list(tenantId);

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Registre as compras — o estoque é atualizado automaticamente."
        action={
          <Button asChild size="sm">
            <Link href="/compras/nova">
              <Plus /> Nova
            </Link>
          </Button>
        }
      />

      {compras.length === 0 ? (
        <EmptyState
          title="Nenhuma compra registrada"
          description="Toque em Nova para registrar sua primeira compra."
          action={
            <Button asChild>
              <Link href="/compras/nova">
                <Plus /> Nova compra
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {compras.map((c) => (
            <Card key={c.id} className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <span className="font-medium">{c.supplier?.name ?? "Sem fornecedor"}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDate(c.purchaseDate)} · {c.items.length} item(ns)
                </span>
              </div>
              <span className="font-semibold tabular-nums">{formatBRL(c.totalAmount)}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
