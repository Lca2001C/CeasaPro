import { AdminService } from "@/lib/services/admin.service";
import { formatBRL } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanoForm } from "./_components/plano-form";

export const dynamic = "force-dynamic";

export default async function PlanosPage() {
  const planos = await AdminService.listPlans();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Planos" description="Planos oferecidos aos clientes." />

      <div className="flex flex-col gap-2">
        {planos.map((p) => (
          <Card key={p.id} className="flex items-center justify-between p-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {!p.active && <Badge variant="secondary">Inativo</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">
                {p.maxUsers ? `Até ${p.maxUsers} usuários` : "Usuários ilimitados"}
              </span>
            </div>
            <span className="font-semibold tabular-nums">{formatBRL(p.priceMonthly)}/mês</span>
          </Card>
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
