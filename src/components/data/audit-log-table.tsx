import { formatDateTime } from "@/lib/format";
import type { AuditLogRow } from "@/lib/services/audit-log.service";
import { EmptyState } from "@/components/data/empty-state";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AuditLogTable({
  rows,
  showTenant = false,
}: {
  rows: AuditLogRow[];
  showTenant?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nenhum evento encontrado"
        description="Ajuste os filtros ou aguarde novas acoes auditadas."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Quando</TableHead>
          {showTenant && <TableHead>Empresa</TableHead>}
          <TableHead>Ator</TableHead>
          <TableHead>Acao</TableHead>
          <TableHead>Entidade</TableHead>
          <TableHead>IP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {formatDateTime(row.createdAt)}
            </TableCell>
            {showTenant && (
              <TableCell className="min-w-44">
                <span className="block truncate text-sm font-medium">
                  {row.tenantName ?? row.tenantId ?? "Sistema"}
                </span>
                {row.tenantId && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.tenantId}
                  </span>
                )}
              </TableCell>
            )}
            <TableCell className="min-w-44">
              <span className="block truncate text-sm font-medium">
                {row.actorEmail ?? "Sistema"}
              </span>
              {row.userId && (
                <span className="block truncate text-xs text-muted-foreground">{row.userId}</span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={badgeVariant(row.action)}>{row.action}</Badge>
            </TableCell>
            <TableCell className="min-w-44">
              <span className="block truncate text-sm font-medium">{row.entity}</span>
              {row.entityId && (
                <span className="block truncate text-xs text-muted-foreground">
                  {row.entityId}
                </span>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {row.ip ?? "-"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function badgeVariant(action: string): BadgeProps["variant"] {
  if (action === "DELETE") return "destructive";
  if (action === "UPDATE" || action === "STATUS_CHANGE") return "warning";
  if (action === "CREATE" || action === "LOGIN" || action === "PAYMENT") return "success";
  return "secondary";
}
