import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { ComprasService } from "@/lib/services/compras.service";
import { formatBRL, formatDate, formatQty } from "@/lib/format";
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
            <Card key={c.id} className="overflow-hidden">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <span className="font-medium">{c.supplier?.name ?? "Sem fornecedor"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(c.purchaseDate)} · {c.items.length} item(ns)
                      {Number(c.freight) > 0 ? ` · frete ${formatBRL(c.freight)}` : ""}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      {formatBRL(c.totalAmount)}
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </div>
                </summary>

                <div className="border-t bg-muted/30 px-3 py-2">
                  <div className="flex flex-col divide-y">
                    {c.items.map((it) => (
                      <div
                        key={it.id}
                        className="flex items-center justify-between gap-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 truncate">{it.product.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatQty(it.quantity)} × {formatBRL(it.unitPrice)}
                        </span>
                        <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                          {formatBRL(it.lineTotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {Number(c.freight) > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      O frete de {formatBRL(c.freight)} já está rateado no custo de cada
                      produto.
                    </p>
                  )}
                </div>
              </details>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
