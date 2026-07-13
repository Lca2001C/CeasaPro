import Link from "next/link";
import { Check, X, AlertTriangle, BadgeCheck } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { PlanoService } from "@/lib/services/plano.service";
import { isOptionalModuleKey, OPTIONAL_MODULES } from "@/lib/plan/modules";
import { formatBRL, formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function MeuPlanoPage({
  searchParams,
}: {
  searchParams: Promise<{ bloqueado?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;
  const view = await PlanoService.getPlanoView(tenantId);

  const bloqueadoLabel =
    sp.bloqueado && isOptionalModuleKey(sp.bloqueado)
      ? OPTIONAL_MODULES[sp.bloqueado].label
      : null;

  if (!view) {
    return (
      <div>
        <PageHeader title="Meu plano" />
        <EmptyState title="Sem assinatura ativa" description="Fale com o suporte." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Meu plano" description="O que está incluído no seu plano e o uso atual." />

      {bloqueadoLabel && (
        <Card className="flex items-center gap-2 border-warning/40 bg-warning/10 p-3">
          <AlertTriangle className="size-5 shrink-0 text-warning" />
          <p className="text-sm">
            O recurso <b>{bloqueadoLabel}</b> não está incluído no seu plano. Fale com o
            suporte para fazer upgrade.
          </p>
        </Card>
      )}

      <Card>
        <CardContent className="flex items-center justify-between pt-4">
          <div className="flex items-center gap-3">
            <BadgeCheck className="size-8 text-primary" />
            <div>
              <p className="font-semibold">{view.planName}</p>
              <p className="text-sm text-muted-foreground">
                {SUBSCRIPTION_STATUS_LABELS[view.status] ?? view.status} ·{" "}
                {formatBRL(view.priceMonthly as number)}/mês
                {view.currentPeriodEnd ? ` · vence ${formatDate(view.currentPeriodEnd)}` : ""}
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <Link href="/assinatura">Assinatura</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Produtos cadastrados" value={String(view.usage.produtos)} />
        <StatCard
          label="Usuários"
          value={view.maxUsers ? `${view.usage.usuarios} / ${view.maxUsers}` : String(view.usage.usuarios)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recursos do plano</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {view.modules.map((m) => (
            <div key={m.key} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                  m.enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                )}
              >
                {m.enabled ? <Check className="size-3.5" /> : <X className="size-3.5" />}
              </span>
              <div>
                <p className={cn("text-sm font-medium", !m.enabled && "text-muted-foreground")}>
                  {m.label}
                </p>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </div>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">
            Os recursos básicos (produtos, vendas, fiado, estoque, despesas e relatórios
            básicos) estão sempre incluídos.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
