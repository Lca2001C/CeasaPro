import { notFound } from "next/navigation";
import { AdminService } from "@/lib/services/admin.service";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
import {
  SUBSCRIPTION_STATUS_LABELS,
  TENANT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusActions } from "./_components/status-actions";

export const dynamic = "force-dynamic";

export default async function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await AdminService.getTenant(id).catch(() => null);
  if (!t) notFound();
  const sub = t.subscription;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t.tradeName}
        description={t.legalName ?? undefined}
        action={<Badge>{TENANT_STATUS_LABELS[t.status]}</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Situação da empresa</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StatusActions tenantId={t.id} current={t.status} />
          <p className="text-xs text-muted-foreground">
            Suspender/Bloquear derruba imediatamente as sessões ativas da empresa.
          </p>
        </CardContent>
      </Card>

      {sub && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assinatura</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="block text-xs text-muted-foreground">Plano</span>
              {sub.plan.name}
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">Situação</span>
              {SUBSCRIPTION_STATUS_LABELS[sub.status]}
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">Mensalidade</span>
              {formatBRL(sub.monthlyAmount)}
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">Vencimento atual</span>
              {formatDate(sub.currentPeriodEnd)}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuários ({t.users.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {t.users.map((u) => (
            <div key={u.id} className="flex justify-between">
              <span>{u.name}</span>
              <span className="text-muted-foreground">{u.email}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {sub && sub.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pagamentos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {sub.payments.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span>
                  {formatDateTime(p.createdAt)} · {p.referenceMonth}
                </span>
                <span>
                  {formatBRL(p.amount)}{" "}
                  <Badge variant={p.status === "APROVADO" ? "success" : "secondary"}>
                    {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                  </Badge>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
