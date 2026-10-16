import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { DespesasService } from "@/lib/services/despesas.service";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
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
  const [e, categories, fornecedores] = await Promise.all([
    DespesasService.get(tenantId, id).catch(() => null),
    DespesasService.listCategories(tenantId),
    FornecedoresService.list(tenantId),
  ]);
  if (!e) notFound();
  const fornecedorDaConta = e.supplierId
    ? (fornecedores.find((f) => f.id === e.supplierId)?.name ?? null)
    : null;

  return (
    <div>
      <PageHeader title="Editar despesa" />
      <DespesaForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        fornecedores={fornecedores
          .filter((f) => f.active || f.id === e.supplierId)
          .map((f) => ({ id: f.id, name: f.name }))}
        compra={e.origem === "MANUAL" ? undefined : { fornecedor: fornecedorDaConta }}
        initial={{
          id: e.id,
          description: e.description,
          amount: Number(e.amount),
          type: e.type,
          status: e.status,
          categoryId: e.categoryId ?? null,
          paymentMethod: e.paymentMethod ?? null,
          recurring: e.recurring,
          supplierId: e.supplierId ?? null,
          dueDate: toInput(e.dueDate),
          paidDate: toInput(e.paidDate),
        }}
      />
    </div>
  );
}
