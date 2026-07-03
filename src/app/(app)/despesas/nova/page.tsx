import { requireTenant } from "@/lib/auth/session";
import { DespesasService } from "@/lib/services/despesas.service";
import { PageHeader } from "@/components/data/page-header";
import { DespesaForm } from "../_components/despesa-form";

export const dynamic = "force-dynamic";

export default async function NovaDespesaPage() {
  const { tenantId } = await requireTenant();
  const categories = await DespesasService.listCategories(tenantId);
  return (
    <div>
      <PageHeader title="Nova despesa" />
      <DespesaForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
