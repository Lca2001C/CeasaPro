import { requireTenant } from "@/lib/auth/session";
import { AuditoriaService } from "@/lib/services/auditoria.service";
import { AUDIT_ENTITY_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { AuditList, type AuditEntry } from "@/components/data/audit-list";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AtividadesPage({
  searchParams,
}: {
  searchParams: Promise<{ entidade?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { entidade } = await searchParams;
  const [logs, entities] = await Promise.all([
    AuditoriaService.listForTenant(tenantId, entidade || undefined),
    AuditoriaService.listEntities(tenantId),
  ]);

  return (
    <div>
      <PageHeader
        title="Atividades"
        description="Histórico de tudo que foi feito no sistema (quem, o quê e quando)."
      />

      <form method="GET" className="no-print mb-4 flex gap-2">
        <div className="w-56">
          <Select name="entidade" defaultValue={entidade ?? ""}>
            <option value="">Todas as áreas</option>
            {entities.map((e) => (
              <option key={e} value={e}>
                {AUDIT_ENTITY_LABELS[e] ?? e}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      <AuditList logs={logs as AuditEntry[]} />
    </div>
  );
}
