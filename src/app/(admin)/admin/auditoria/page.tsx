<<<<<<< HEAD
import Link from "next/link";
import { AdminService } from "@/lib/services/admin.service";
import { AuditLogService } from "@/lib/services/audit-log.service";
import { PageHeader } from "@/components/data/page-header";
import { AuditLogTable } from "@/components/data/audit-log-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
=======
import { AuditoriaService } from "@/lib/services/auditoria.service";
import { AUDIT_ENTITY_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { AuditList, type AuditEntry } from "@/components/data/audit-list";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
>>>>>>> 3dd6880 (feat/adicionando teste e CI/CD)

export const dynamic = "force-dynamic";

export default async function AdminAuditoriaPage({
  searchParams,
}: {
<<<<<<< HEAD
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
=======
  searchParams: Promise<{ entidade?: string }>;
}) {
  const { entidade } = await searchParams;
  const [logs, entities] = await Promise.all([
    AuditoriaService.listGlobal(entidade || undefined),
    AuditoriaService.listEntities(),
>>>>>>> 3dd6880 (feat/adicionando teste e CI/CD)
  ]);

  return (
    <div>
      <PageHeader
        title="Auditoria"
<<<<<<< HEAD
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
=======
        description="Trilha completa de atividades de todas as empresas e da plataforma."
      />

      <form method="GET" className="mb-4 flex gap-2">
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
>>>>>>> 3dd6880 (feat/adicionando teste e CI/CD)
