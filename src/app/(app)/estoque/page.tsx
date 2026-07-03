import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { EstoqueService } from "@/lib/services/estoque.service";
import { formatBRL, formatQty } from "@/lib/format";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { add } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function EstoquePage() {
  const { tenantId } = await requireTenant();
  const posicoes = await EstoqueService.getPositions(tenantId);
  const total = add(...posicoes.map((p) => p.value));

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Posição atual, calculada pelas entradas e saídas."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/estoque/ajuste">
              <SlidersHorizontal /> Ajuste
            </Link>
          </Button>
        }
      />

      <div className="mb-4">
        <StatCard label="Valor total em estoque" value={formatBRL(total)} />
      </div>

      {posicoes.length === 0 ? (
        <EmptyState
          title="Nenhum produto no estoque"
          description="Cadastre produtos e registre compras para movimentar o estoque."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {posicoes.map((p) => (
            <Card key={p.productId} className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <span className="truncate font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatQty(p.quantity)} {SALE_UNIT_LABELS[p.saleUnit] ?? ""}
                </span>
              </div>
              <span className="font-semibold tabular-nums">{formatBRL(p.value)}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
