import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { Pdv } from "./_components/pdv";

export const dynamic = "force-dynamic";

export default async function NovaVendaPage() {
  const { tenantId } = await requireTenant();
  const [produtos, saldo] = await Promise.all([
    ProdutosService.list(tenantId),
    CaixasService.getSaldo(tenantId),
  ]);
  const ativos = produtos
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name, saleUnit: p.saleUnit }));
  return <Pdv produtos={ativos} caixasLimpas={saldo.limpas} />;
}
