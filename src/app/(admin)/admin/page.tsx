import { AdminService } from "@/lib/services/admin.service";
import { formatBRL } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const m = await AdminService.metrics();
  const ativos = m.byStatus["ATIVO"] ?? 0;
  const suspensos = (m.byStatus["SUSPENSO"] ?? 0) + (m.byStatus["BLOQUEADO"] ?? 0);
  const vencidos = m.byStatus["VENCIDO"] ?? 0;

  return (
    <div>
      <PageHeader title="Visão geral" description="Métricas da plataforma." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Empresas" value={String(m.totalTenants)} />
        <StatCard label="Receita mensal (MRR)" value={formatBRL(m.mrr)} tone="success" />
        <StatCard label="Ativas" value={String(ativos)} />
        <StatCard label="Inadimplentes" value={String(suspensos + vencidos)} tone="warning" />
        <StatCard label="Novos clientes no mês" value={String(m.novosNoMes)} />
        <StatCard label="Recebido no mês" value={formatBRL(m.receitaMes)} tone="success" />
        <StatCard label="Em teste grátis" value={String(m.byStatus["TRIAL"] ?? 0)} />
        <StatCard label="Pagamentos aprovados" value={String(m.paymentsApproved)} />
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Assinaturas por status</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(m.byStatus).map(([status, count]) => (
            <div key={status} className="rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">{SUBSCRIPTION_STATUS_LABELS[status] ?? status}:</span>{" "}
              {count}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
