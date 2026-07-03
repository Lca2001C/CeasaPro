import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import { PageHeader } from "@/components/data/page-header";
import { FornecedorForm } from "../_components/fornecedor-form";

export const dynamic = "force-dynamic";

export default async function EditarFornecedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const f = await FornecedoresService.get(tenantId, id).catch(() => null);
  if (!f) notFound();

  return (
    <div>
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
    </div>
  );
}
