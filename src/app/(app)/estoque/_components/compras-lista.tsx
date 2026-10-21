import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { ComprasService } from "@/lib/services/compras.service";
import { formatBRL, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { SITUACAO_COMPRA_LABELS, situacaoDaCompra } from "@/lib/despesas/situacao-compra";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PagarCompraButton } from "./pagar-compra-button";
import { CancelarCompraButton } from "./cancelar-compra-button";

type Compra = Awaited<ReturnType<typeof ComprasService.list>>[number];

/**
 * Aba "Compras" do Estoque: o histórico que antes vivia em `/compras`, agora
 * com a situação da conta de cada compra (paga, a pagar, vencida). A compra
 * cancelada continua aqui, riscada — como a venda cancelada no histórico.
 */
export function ComprasLista({ compras }: { compras: Compra[] }) {
  if (compras.length === 0) {
    return (
      <EmptyState
        title="Nenhuma compra registrada"
        description="Registre o que chegou do fornecedor: o estoque sobe e a conta vai para Despesas."
        action={
          <Button asChild>
            <Link href="/estoque/compra">
              <Plus /> Registrar compra
            </Link>
          </Button>
        }
      />
    );
  }

  const agora = new Date();
  return (
    <div className="flex flex-col gap-2">
      {compras.map((c) => {
        const conta = c.expenses[0];
        const situacao = situacaoDaCompra(conta, agora);
        const cancelada = c.cancelledAt !== null;
        return (
          <Card key={c.id} className={cn("overflow-hidden", cancelada && "opacity-70")}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.supplier?.name ?? "Sem fornecedor"}</span>
                    {cancelada && <Badge variant="destructive">Cancelada</Badge>}
                    {!cancelada && situacao !== "SEM_CONTA" && (
                      <Badge
                        variant={
                          situacao === "PAGA"
                            ? "success"
                            : situacao === "VENCIDA"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {SITUACAO_COMPRA_LABELS[situacao]}
                      </Badge>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(c.purchaseDate)} · {c.items.length} item(ns)
                    {Number(c.freight) > 0 ? ` · frete ${formatBRL(c.freight)}` : ""}
                    {conta && conta.status === "PENDENTE" && conta.dueDate
                      ? ` · vence ${formatDate(conta.dueDate)}`
                      : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn("font-semibold tabular-nums", cancelada && "line-through")}>
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
                    O frete de {formatBRL(c.freight)} já está rateado no custo de cada produto.
                  </p>
                )}
                {cancelada && c.cancelledAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Cancelada em {formatDateTime(c.cancelledAt)}
                    {c.cancelledReason ? ` — ${c.cancelledReason}` : ""}. Não entra em compras,
                    estoque, custo nem contas a pagar.
                  </p>
                )}
                {!cancelada && (conta || c.podeCancelarAgora) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {conta?.status === "PENDENTE" && <PagarCompraButton despesaId={conta.id} />}
                    {conta && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/despesas/${conta.id}`}>Ver a conta</Link>
                      </Button>
                    )}
                    {c.podeCancelarAgora && (
                      <CancelarCompraButton id={c.id} total={formatBRL(c.totalAmount)} />
                    )}
                  </div>
                )}
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}
