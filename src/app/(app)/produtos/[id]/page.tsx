import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { PageHeader } from "@/components/data/page-header";
import { ProdutoForm } from "../_components/produto-form";

export const dynamic = "force-dynamic";

export default async function EditarProdutoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();

  const p = await ProdutosService.get(tenantId, id).catch(() => null);
  if (!p) notFound();

  return (
    <div>
      <PageHeader title="Editar produto" />
      <ProdutoForm
        initial={{
          id: p.id,
          name: p.name,
          saleUnit: p.saleUnit,
          recipientType: p.recipientType ?? null,
          qtyPerRecipient: p.qtyPerRecipient ? Number(p.qtyPerRecipient) : null,
          sackCapacity: p.sackCapacity ? Number(p.sackCapacity) : null,
          active: p.active,
        }}
      />
    </div>
  );
}
