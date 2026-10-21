import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { EstoqueService } from "@/lib/services/estoque.service";
import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { formatBRL, formatDateTime, formatQty } from "@/lib/format";
import { STOCK_MOVEMENT_LABELS } from "@/lib/labels";
import { HORAS_PARA_DESFAZER } from "@/lib/desfazer/prazo";
import { AjusteForm } from "./_components/ajuste-form";
import { DesfazerAjusteButton } from "./_components/desfazer-ajuste-button";

export const dynamic = "force-dynamic";

export default async function AjusteEstoquePage() {
  const { tenantId } = await requireTenant();
  const [produtos, recentes] = await Promise.all([
    ProdutosService.list(tenantId),
    EstoqueService.ajustesRecentes(tenantId),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Ajuste de estoque" description="Registre quebra, perda, doação ou acerto." />
      <AjusteForm produtos={produtos.map((p) => ({ id: p.id, name: p.name }))} />

      {/* Lançou errado? Até 24 h dá para desfazer — com estorno, sem apagar. */}
      {recentes.length > 0 && (
        <section>
          <h2 className="mb-1 px-1 text-sm font-semibold text-muted-foreground">
            Ajustes das últimas {HORAS_PARA_DESFAZER} h
          </h2>
          <p className="mb-2 px-1 text-sm text-muted-foreground">
            Só dá para desfazer enquanto o produto não teve outro movimento depois do ajuste.
          </p>
          <Card className="divide-y divide-border/70 overflow-hidden">
            {recentes.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="block truncate font-semibold">{a.product.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {STOCK_MOVEMENT_LABELS[a.type] ?? a.type} · {formatQty(a.quantity)} ·{" "}
                    {formatBRL(a.unitCost ?? 0)}/un · {formatDateTime(a.createdAt)}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </span>
                </div>
                {a.podeDesfazer ? (
                  <DesfazerAjusteButton id={a.id} />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Já houve movimento depois — lance um novo ajuste para corrigir.
                  </span>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
