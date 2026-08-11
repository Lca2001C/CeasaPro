import { AdminService } from "@/lib/services/admin.service";
import { planModules } from "@/lib/plan/modules";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanoForm } from "./_components/plano-form";
import { PlanoRow } from "./_components/plano-row";

export const dynamic = "force-dynamic";

export default async function PlanosPage() {
  const planos = await AdminService.listPlans();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Planos" description="Planos oferecidos aos clientes e os módulos de cada um." />

      <div className="flex flex-col gap-2">
        {planos.map((p) => (
          <PlanoRow
            key={p.id}
            plano={{
              id: p.id,
              name: p.name,
              priceMonthly: Number(p.priceMonthly),
              maxUsers: p.maxUsers,
              active: p.active,
              modules: planModules(p.features),
            }}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Novo plano</CardTitle>
        </CardHeader>
        <CardContent>
          <PlanoForm />
        </CardContent>
      </Card>
    </div>
  );
}
