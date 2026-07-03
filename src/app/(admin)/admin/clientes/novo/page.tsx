import { AdminService } from "@/lib/services/admin.service";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { EmpresaForm } from "./_components/empresa-form";

export const dynamic = "force-dynamic";

export default async function NovaEmpresaPage() {
  const planos = await AdminService.listPlans();
  const ativos = planos.filter((p) => p.active);

  return (
    <div>
      <PageHeader title="Nova empresa" />
      {ativos.length === 0 ? (
        <EmptyState
          title="Cadastre um plano primeiro"
          description="É preciso ter ao menos um plano ativo para criar uma empresa."
        />
      ) : (
        <EmpresaForm
          planos={ativos.map((p) => ({
            id: p.id,
            name: p.name,
            priceMonthly: Number(p.priceMonthly),
          }))}
        />
      )}
    </div>
  );
}
