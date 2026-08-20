import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { PageHeader } from "@/components/data/page-header";
import { FiadoForm } from "./_components/fiado-form";

export const dynamic = "force-dynamic";

export default async function NovoFiadoPage() {
  const { tenantId } = await requireTenant();
  const [produtos, saldo] = await Promise.all([
    ProdutosService.list(tenantId),
    CaixasService.getSaldo(tenantId),
  ]);

  return (
    <div>
      <PageHeader
        title="Novo fiado"
        description="Lance uma venda a prazo com os produtos, o total e as caixas plásticas."
      />
      <FiadoForm
        produtos={produtos
          .filter((p) => p.active)
          .map((p) => ({ id: p.id, name: p.name, saleUnit: p.saleUnit }))}
        caixasLimpas={saldo.limpas}
      />
    </div>
  );
}
