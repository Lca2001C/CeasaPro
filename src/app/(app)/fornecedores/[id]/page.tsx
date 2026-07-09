import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import { formatBRL, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { FornecedorForm } from "../_components/fornecedor-form";

export const dynamic = "force-dynamic";

export default async function EditarFornecedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const [f, compras] = await Promise.all([
    FornecedoresService.get(tenantId, id).catch(() => null),
    FornecedoresService.purchaseHistory(tenantId, id),
  ]);
  if (!f) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Editar fornecedor" />
      <FornecedorForm
        initial={{
          id: f.id,
          name: f.name,
          phone: f.phone ?? null,
          address: f.address ?? null,
          notes: f.notes ?? null,
          active: f.active,
        }}
      />

      <Card>
        <CardContent className="pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Historico de compras</h2>
            <span className="text-xs text-muted-foreground">Ultimas 50 compras</span>
          </div>

          {compras.length === 0 ? (
            <EmptyState
              title="Nenhuma compra deste fornecedor"
              description="As compras vinculadas a este fornecedor aparecerao aqui."
            />
          ) : (
            <div className="flex flex-col divide-y">
              {compras.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatDate(c.purchaseDate)}</p>
                    {c.notes && (
                      <p className="truncate text-xs text-muted-foreground">{c.notes}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatBRL(c.totalAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
