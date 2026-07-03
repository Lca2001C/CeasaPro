import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { FiadoService } from "@/lib/services/fiado.service";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PagamentoForm } from "./_components/pagamento-form";

export const dynamic = "force-dynamic";

export default async function FiadoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const conta = await FiadoService.get(tenantId, id).catch(() => null);
  if (!conta) notFound();

  const pago = conta.status === "PAGO";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={conta.customerName} description="Conta de fiado" />

      <Card>
        <CardContent className="grid grid-cols-3 gap-2 pt-4 text-center">
          <div>
            <span className="block text-xs text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">{formatBRL(conta.totalAmount)}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Pago</span>
            <span className="font-semibold tabular-nums text-success">
              {formatBRL(conta.paidAmount)}
            </span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Saldo</span>
            <span className="font-semibold tabular-nums text-warning">
              {formatBRL(conta.saldo)}
            </span>
          </div>
        </CardContent>
      </Card>

      {pago ? (
        <Badge variant="success" className="self-start">
          Conta quitada
        </Badge>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar pagamento</CardTitle>
          </CardHeader>
          <CardContent>
            <PagamentoForm accountId={conta.id} saldo={Number(conta.saldo)} />
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          Pagamentos ({conta.payments.length})
        </h2>
        {conta.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pagamento ainda.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {conta.payments.map((p) => (
              <Card key={p.id} className="flex items-center justify-between p-3 text-sm">
                <span>
                  {formatDateTime(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method]}
                </span>
                <span className="font-semibold tabular-nums">{formatBRL(p.amount)}</span>
              </Card>
            ))}
          </div>
        )}
      </div>

      {conta.dueDate && (
        <p className="text-xs text-muted-foreground">Vencimento: {formatDate(conta.dueDate)}</p>
      )}
    </div>
  );
}
