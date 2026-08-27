import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { DespesasService } from "@/lib/services/despesas.service";
import { isoDateTz } from "@/lib/tz";
import { PageHeader } from "@/components/data/page-header";
import { DespesaForm } from "../_components/despesa-form";

export const dynamic = "force-dynamic";

/**
 * Data para `<input type="date">`, no fuso do app. Com `toISOString` o campo
 * abria com o dia seguinte para qualquer data gravada a partir das 21h.
 */
function toInput(d: Date | null): string | null {
  return d ? isoDateTz(new Date(d)) : null;
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
