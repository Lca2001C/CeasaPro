import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { DespesasService } from "@/lib/services/despesas.service";
import { PageHeader } from "@/components/data/page-header";
import { DespesaForm } from "../_components/despesa-form";

export const dynamic = "force-dynamic";

function toInput(d: Date | null): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

export default async function EditarDespesaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const [e, categories] = await Promise.all([
    DespesasService.get(tenantId, id).catch(() => null),
    DespesasService.listCategories(tenantId),
  ]);
  if (!e) notFound();

  return (
    <div>
      <PageHeader title="Editar despesa" />
      <DespesaForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        initial={{
          id: e.id,
          description: e.description,
          amount: Number(e.amount),
          type: e.type,
          status: e.status,
          categoryId: e.categoryId ?? null,
          dueDate: toInput(e.dueDate),
          paidDate: toInput(e.paidDate),
        }}
      />
    </div>
  );
}
