import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { formatBRL, formatDate } from "@/lib/format";
import { CRATE_CLEANING_STATUS_LABELS, CRATE_MOVEMENT_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  const editavel = c.returnedQty === 0 && Number(c.paidAmount) === 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={c.cleanerName}
        description={`Envio de ${formatDate(c.sentDate)}`}
        action={
          <div className="flex items-center gap-2">
            <Badge variant={c.status === "PAGO" ? "success" : "warning"}>
              {CRATE_CLEANING_STATUS_LABELS[c.status]}
            </Badge>
            {editavel && (
              <Button asChild variant="ghost" size="icon" aria-label="Editar envio">
                <Link href={`/higienizacao/${c.id}/editar`}>
                  <Pencil className="size-4" />
                </Link>
              </Button>
            )}
          </div>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Movimentação de caixas ({c.movimentos.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {c.movimentos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum movimento de estoque vinculado a este envio.
            </p>
          ) : (
            c.movimentos.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <span className="block font-medium">{CRATE_MOVEMENT_LABELS[m.type]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(m.movementDate)}
                    {m.notes ? ` · ${m.notes}` : ""}
                  </span>
                </div>
                <span className="font-semibold tabular-nums">{m.quantity}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AcoesHigienizacao
        id={c.id}
        caixasAReceber={c.caixasAReceber}
        valorAPagar={Number(c.valorAPagar)}
      />
    </div>
  );
}
