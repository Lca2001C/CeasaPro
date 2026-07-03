import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { PageHeader } from "@/components/data/page-header";
import { AjusteForm } from "./_components/ajuste-form";

export const dynamic = "force-dynamic";

export default async function AjusteEstoquePage() {
  const { tenantId } = await requireTenant();
  const produtos = await ProdutosService.list(tenantId);
  return (
    <div>
      <PageHeader title="Ajuste de estoque" description="Registre quebra, perda, doação ou acerto." />
      <AjusteForm produtos={produtos.map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  );
}
