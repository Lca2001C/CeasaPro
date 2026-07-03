import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import { PageHeader } from "@/components/data/page-header";
import { CompraForm } from "./_components/compra-form";

export const dynamic = "force-dynamic";

export default async function NovaCompraPage() {
  const { tenantId } = await requireTenant();
  const [produtos, fornecedores] = await Promise.all([
    ProdutosService.list(tenantId),
    FornecedoresService.list(tenantId),
  ]);
  return (
    <div>
      <PageHeader title="Nova compra" />
      <CompraForm
        produtos={produtos.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))}
        fornecedores={fornecedores
          .filter((f) => f.active)
          .map((f) => ({ id: f.id, name: f.name }))}
      />
    </div>
  );
}
