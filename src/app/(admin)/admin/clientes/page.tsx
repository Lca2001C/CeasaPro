import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import { AdminService } from "@/lib/services/admin.service";
import { formatBRL } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS, TENANT_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const tenants = await AdminService.listTenants();

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Empresas assinantes da plataforma."
        action={
          <Button asChild size="sm">
            <Link href="/admin/clientes/novo">
              <Plus /> Nova empresa
            </Link>
          </Button>
        }
      />

      {tenants.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa cadastrada"
          action={
            <Button asChild>
              <Link href="/admin/clientes/novo">
                <Plus /> Nova empresa
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {tenants.map((t) => (
            <Link key={t.id} href={`/admin/clientes/${t.id}`}>
              <Card className="flex items-center justify-between p-3 hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.tradeName}</span>
                    {t.status !== "ACTIVE" && (
                      <Badge variant="destructive">{TENANT_STATUS_LABELS[t.status]}</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t.subscription
                      ? `${SUBSCRIPTION_STATUS_LABELS[t.subscription.status]} · ${formatBRL(t.subscription.monthlyAmount)}/mês`
                      : "Sem assinatura"}
                  </span>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
