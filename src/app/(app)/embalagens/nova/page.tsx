import { requireTenant } from "@/lib/auth/session";
import { EmbalagensService } from "@/lib/services/embalagens.service";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { VendaEmbalagemForm } from "./_components/venda-embalagem-form";

export const dynamic = "force-dynamic";

export default async function NovaVendaEmbalagemPage() {
  const { tenantId } = await requireTenant();
  const tipos = await EmbalagensService.listTypes(tenantId);
  const ativos = tipos.filter((t) => t.active);

  return (
    <div>
      <PageHeader title="Nova venda de embalagem" />
      {ativos.length === 0 ? (
        <EmptyState
          title="Cadastre um tipo de embalagem primeiro"
          description="Vá em Embalagens → aba Tipos e adicione (ex.: Caixa de papelão, Sacaria)."
        />
      ) : (
        <VendaEmbalagemForm tipos={ativos.map((t) => ({ id: t.id, name: t.name }))} />
      )}
    </div>
  );
}
