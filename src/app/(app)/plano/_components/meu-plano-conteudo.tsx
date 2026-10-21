import Link from "next/link";
import { Check, X, AlertTriangle, BadgeCheck, CalendarClock, Package } from "lucide-react";
import { PlanoService } from "@/lib/services/plano.service";
import { isOptionalModuleKey, OPTIONAL_MODULES } from "@/lib/plan/modules";
import { formatBRL, formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconeRedondo } from "@/components/ui/icone-redondo";
import { cn } from "@/lib/cn";
import { TrocarPlano } from "./trocar-plano";

/**
 * Aba "Meu plano" de Configurações: módulos incluídos, uso e troca de plano.
 * O cancelamento fica na aba Assinatura, ao lado.
 */
export async function MeuPlanoConteudo({
  tenantId,
  bloqueado,
}: {
  tenantId: string;
  bloqueado?: string;
}) {
  const sp = { bloqueado };
  const [view, availablePlans] = await Promise.all([
    PlanoService.getPlanoView(tenantId),
    PlanoService.listAvailablePlans(tenantId),
  ]);

  const bloqueadoLabel =
    sp.bloqueado && isOptionalModuleKey(sp.bloqueado)
      ? OPTIONAL_MODULES[sp.bloqueado].label
      : null;

  if (!view) {
    return (
      <EmptyState title="Sem assinatura ativa" description="Fale com o suporte." />
    );
  }

  return (
      <div className="flex flex-col gap-5">
        {bloqueadoLabel && (
          <Card className="flex items-start gap-3 border-warning/40 bg-warning/10 p-4">
            <IconeRedondo tom="warning" tamanho="sm">
              <AlertTriangle />
            </IconeRedondo>
            <p className="min-w-0 self-center text-sm [overflow-wrap:anywhere]">
              O recurso <b>{bloqueadoLabel}</b> não está incluído no seu plano. Fale com o
              suporte para fazer upgrade.
            </p>
          </Card>
        )}

        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <IconeRedondo tamanho="lg">
              <BadgeCheck />
            </IconeRedondo>
            <div className="min-w-0">
              <p className="text-sm font-medium text-muted-foreground">Seu plano</p>
              <p className="text-xl font-bold leading-tight tracking-tight [overflow-wrap:anywhere]">
                {view.planName}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
                {view.cancelledAt
                  ? `Cancelada · acesso até ${view.currentPeriodEnd ? formatDate(view.currentPeriodEnd) : "o vencimento"}`
                  : `${SUBSCRIPTION_STATUS_LABELS[view.status] ?? view.status} · ${formatBRL(view.priceMonthly as number)}/mês${view.currentPeriodEnd ? ` · vence ${formatDate(view.currentPeriodEnd)}` : ""}`}
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="w-full shrink-0 sm:w-auto">
            <Link href="/assinatura">Assinatura</Link>
          </Button>
        </Card>

        <StatCard
          label="Produtos cadastrados"
          value={String(view.usage.produtos)}
          icon={<Package className="size-4" />}
        />

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
            Recursos do plano
          </h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border/60">
              {view.modules.map((m) => (
                <li key={m.key} className="flex items-start gap-3 p-4">
                  {/* Estado do módulo: o tom é semântico, e o ícone (✓ ou ✗)
                      diz o mesmo sem depender da cor. */}
                  <IconeRedondo tom={m.enabled ? "success" : "neutro"} tamanho="sm">
                    {m.enabled ? <Check /> : <X />}
                  </IconeRedondo>
                  <div className="min-w-0 self-center">
                    <p
                      className={cn(
                        "font-semibold [overflow-wrap:anywhere]",
                        !m.enabled && "text-muted-foreground",
                      )}
                    >
                      {m.label}
                      <span className="sr-only">
                        {m.enabled ? " (incluído)" : " (não incluído)"}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {m.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="border-t border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
              Os recursos básicos (produtos, vendas, fiado, estoque, despesas e relatórios
              básicos) estão sempre incluídos.
            </p>
          </Card>
        </section>

        {/*
          A troca agendada precisa aparecer ANTES da lista de planos. Ela é o
          estado menos esperado desta tela: quem acabou de trocar volta aqui e vê o
          plano ANTIGO em "Meu plano" — sem esta faixa, parece que a troca não foi
          registrada e a pessoa tenta de novo.
        */}
        {view.pendingPlan && (
          <Card className="flex items-start gap-3 border-info/40 bg-info/10 p-4">
            <IconeRedondo tom="info" tamanho="sm">
              <CalendarClock />
            </IconeRedondo>
            <p className="min-w-0 self-center text-sm [overflow-wrap:anywhere]">
              Sua troca para o plano <b>{view.pendingPlan.name}</b> (
              {formatBRL(view.pendingPlan.priceMonthly)}/mês) está agendada para{" "}
              <b>{formatDate(view.pendingPlan.from)}</b>. Até lá vale o plano atual, que já
              está pago neste mês.
            </p>
          </Card>
        )}

        {!view.cancelledAt && (
          <TrocarPlano plans={availablePlans} pendingPlan={view.pendingPlan} />
        )}
      </div>
  );
}
