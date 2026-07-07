import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { formatBRL, formatDate } from "@/lib/format";
import { CRATE_CLEANING_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AcoesHigienizacao } from "./_components/acoes-higienizacao";

export const dynamic = "force-dynamic";

export default async function HigienizacaoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const c = await HigienizacaoService.get(tenantId, id).catch(() => null);
  if (!c) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={c.cleanerName}
        description={`Envio de ${formatDate(c.sentDate)}`}
        action={
          <Badge variant={c.status === "PAGO" ? "success" : "warning"}>
            {CRATE_CLEANING_STATUS_LABELS[c.status]}
          </Badge>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-4 text-sm sm:grid-cols-4">
          <div>
            <span className="block text-xs text-muted-foreground">Enviadas</span>
            <span className="font-semibold tabular-nums">{c.sentQty}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Devolvidas</span>
            <span className="font-semibold tabular-nums">{c.returnedQty}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Caixas a receber</span>
            <span className="font-semibold tabular-nums text-warning">{c.caixasAReceber}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Valor por caixa</span>
            <span className="font-semibold tabular-nums">{formatBRL(c.unitPrice)}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Valor total</span>
            <span className="font-semibold tabular-nums">{formatBRL(c.totalAmount)}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Pago</span>
            <span className="font-semibold tabular-nums text-success">
              {formatBRL(c.paidAmount)}
            </span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">A pagar</span>
            <span className="font-semibold tabular-nums text-destructive">
              {formatBRL(c.valorAPagar)}
            </span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Última devolução</span>
            <span className="font-semibold">{formatDate(c.returnedDate)}</span>
          </div>
        </CardContent>
      </Card>

      {c.notes && <p className="text-sm text-muted-foreground">Obs.: {c.notes}</p>}

      <AcoesHigienizacao
        id={c.id}
        caixasAReceber={c.caixasAReceber}
        valorAPagar={Number(c.valorAPagar)}
      />
    </div>
  );
}
