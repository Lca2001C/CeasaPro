import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { AuditLogService } from "@/lib/services/audit-log.service";
import { PageHeader } from "@/components/data/page-header";
import { AuditLogTable } from "@/components/data/audit-log-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; actorEmail?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;
  const filters = {
    action: sp.action,
    entity: sp.entity,
    actorEmail: sp.actorEmail,
  };
  const rows = await AuditLogService.listForTenant(tenantId, filters);

  return (
    <div>
      <PageHeader
        title="Auditoria"
        description="Ultimos 100 eventos registrados para esta empresa."
      />
      <AuditFilters defaultValues={filters} />
      <AuditLogTable rows={rows} />
    </div>
  );
}

function AuditFilters({
  defaultValues,
}: {
  defaultValues: { action?: string; entity?: string; actorEmail?: string };
}) {
  return (
    <form className="mb-4 grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_1fr_auto_auto]">
      <Input
        name="action"
        defaultValue={defaultValues.action ?? ""}
        placeholder="Acao: CREATE, UPDATE..."
      />
      <Input name="entity" defaultValue={defaultValues.entity ?? ""} placeholder="Entidade" />
      <Input
        name="actorEmail"
        defaultValue={defaultValues.actorEmail ?? ""}
        placeholder="E-mail do ator"
      />
      <Button type="submit">Filtrar</Button>
      <Button asChild type="button" variant="outline">
        <Link href="/auditoria">Limpar</Link>
      </Button>
    </form>
  );
}
