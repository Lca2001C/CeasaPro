import { formatDateTime } from "@/lib/format";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from "@/lib/labels";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/data/empty-state";

export interface AuditEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  oldData: unknown;
  newData: unknown;
  ip: string | null;
  createdAt: Date;
  tenantName?: string;
}

function describe(l: AuditEntry): string {
  const who = l.actorEmail ?? "Sistema";
  const acao = AUDIT_ACTION_LABELS[l.action] ?? l.action.toLowerCase();
  if (l.action === "LOGIN") return `${who} entrou no sistema`;
  const ent = AUDIT_ENTITY_LABELS[l.entity] ?? l.entity;
  return `${who} ${acao} ${ent}`;
}

function pretty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  try {
    const s = JSON.stringify(v, null, 2);
    return s === "{}" ? null : s;
  } catch {
    return null;
  }
}

/** Lista de registros de auditoria em linguagem simples, com detalhes expansíveis. */
export function AuditList({ logs }: { logs: AuditEntry[] }) {
  if (logs.length === 0) {
    return (
      <EmptyState
        title="Nenhuma atividade registrada"
        description="As ações feitas no sistema aparecem aqui."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {logs.map((l) => {
        const antes = pretty(l.oldData);
        const depois = pretty(l.newData);
        return (
          <Card key={l.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{describe(l)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(l.createdAt)}
                  {l.tenantName ? ` · ${l.tenantName}` : ""}
                  {l.ip ? ` · IP ${l.ip}` : ""}
                </p>
              </div>
            </div>
            {(antes || depois) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Ver detalhes
                </summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {antes && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Antes</p>
                      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                        {antes}
                      </pre>
                    </div>
                  )}
                  {depois && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Depois</p>
                      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                        {depois}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
