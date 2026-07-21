import Link from "next/link";
import { AdminService } from "@/lib/services/admin.service";
import { AuditLogService } from "@/lib/services/audit-log.service";
import { PageHeader } from "@/components/data/page-header";
import { AuditLogTable } from "@/components/data/audit-log-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export const dynamic = "force-dynamic";

export default async function AdminAuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{
    tenantId?: string;
    action?: string;
    entity?: string;
    actorEmail?: string;
  }>;
}) {
  const sp = await searchParams;
  const filters = {
    tenantId: sp.tenantId,
    action: sp.action,
    entity: sp.entity,
    actorEmail: sp.actorEmail,
  };
  const [rows, tenants] = await Promise.all([
    AuditLogService.listForAdmin(filters),
    AdminService.listTenants(),
  ]);

  return (
    <div>
      <PageHeader
        title="Auditoria"
        description="Ultimos 100 eventos da plataforma. Payloads sensiveis nao sao exibidos."
      />
      <AdminAuditFilters defaultValues={filters} tenants={tenants} />
      <AuditLogTable rows={rows} showTenant />
    </div>
  );
}

function AdminAuditFilters({
  defaultValues,
  tenants,
}: {
  defaultValues: {
    tenantId?: string;
    action?: string;
    entity?: string;
    actorEmail?: string;
  };
  tenants: Awaited<ReturnType<typeof AdminService.listTenants>>;
}) {
  return (
    <form className="mb-4 grid gap-2 rounded-md border p-3 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto_auto]">
      <Select name="tenantId" defaultValue={defaultValues.tenantId ?? ""}>
        <option value="">Todas as empresas</option>
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.tradeName}
          </option>
        ))}
      </Select>
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
        <Link href="/admin/auditoria">Limpar</Link>
      </Button>
    </form>
  );
}
