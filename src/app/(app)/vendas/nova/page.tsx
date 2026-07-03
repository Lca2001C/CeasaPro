import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { Pdv } from "./_components/pdv";

export const dynamic = "force-dynamic";

export default async function NovaVendaPage() {
  const { tenantId } = await requireTenant();
  const produtos = await ProdutosService.list(tenantId);
  const ativos = produtos
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name, saleUnit: p.saleUnit }));
  return <Pdv produtos={ativos} />;
}
