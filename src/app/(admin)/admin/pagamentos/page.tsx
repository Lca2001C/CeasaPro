import { AdminService } from "@/lib/services/admin.service";
import { formatBRL, formatDateTime } from "@/lib/format";
import { PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function PagamentosPage() {
  const pagamentos = await AdminService.listPayments();

  return (
    <div>
      <PageHeader title="Pagamentos" description="Cobranças de mensalidade de todas as empresas." />
      {pagamentos.length === 0 ? (
        <EmptyState
          title="Nenhum pagamento registrado"
          description="As cobranças de mensalidade (Mercado Pago) aparecem aqui."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {pagamentos.map((p) => (
            <Card key={p.id} className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <span className="truncate font-medium">
                  {p.subscription.tenant.tradeName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(p.createdAt)} · ref. {p.referenceMonth}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">{formatBRL(p.amount)}</span>
                <Badge variant={p.status === "APROVADO" ? "success" : "secondary"}>
                  {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
