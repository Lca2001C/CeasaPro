import Link from "next/link";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { VendasService } from "@/lib/services/vendas.service";
import { formatBRL, formatDateTime, formatQty } from "@/lib/format";
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
            <Card key={v.id} className="overflow-hidden">
              {/* `<details>`: os itens já vêm carregados com a lista, então
                  abrir não custa consulta nem navegação — e a dúvida "o que
                  foi vendido aqui?" some sem sair da tela. */}
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{v.customerName || "Cliente"}</span>
                      <Badge variant={v.paymentMethod === "FIADO" ? "warning" : "secondary"}>
                        {PAYMENT_METHOD_LABELS[v.paymentMethod]}
                      </Badge>
                      {v.plasticCrateQty > 0 && (
                        <Badge variant="outline">{v.plasticCrateQty} cx</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(v.saleDate)} · {v.items.length} item(ns)
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      {formatBRL(v.totalAmount)}
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </div>
                </summary>

                <div className="border-t bg-muted/30 px-3 py-2">
                  <div className="flex flex-col divide-y">
                    {v.items.map((it) => (
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
                  {v.creditAccount && (
                    <Link
                      href={`/fiado/${v.creditAccount.id}`}
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-2"
                    >
                      Ver conta no fiado <ChevronRight className="size-3" />
                    </Link>
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
