import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CRATE_CLEANING_STATUS_LABELS, CRATE_MOVEMENT_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
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
    <div>
      <PageHeader
        title={c.cleanerName}
        description={`Envio de ${formatDate(c.sentDate)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={c.status === "PAGO" ? "success" : "warning"}>
              {CRATE_CLEANING_STATUS_LABELS[c.status]}
            </Badge>
            {editavel && (
              <Button asChild variant="info" size="sm" aria-label="Editar envio">
                <Link href={`/higienizacao/${c.id}/editar`}>
                  <Pencil /> Editar
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-5">
        <Card className="p-4 sm:p-5">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
            <Dado rotulo="Enviadas">{c.sentQty}</Dado>
            <Dado rotulo="Devolvidas">{c.returnedQty}</Dado>
            <Dado rotulo="Caixas a receber" className="text-warning">
              {c.caixasAReceber}
            </Dado>
            <Dado rotulo="Valor por caixa">{formatBRL(c.unitPrice)}</Dado>
            <Dado rotulo="Valor total">{formatBRL(c.totalAmount)}</Dado>
            <Dado rotulo="Pago" className="text-success">
              {formatBRL(c.paidAmount)}
            </Dado>
            <Dado rotulo="A pagar" className="text-destructive">
              {formatBRL(c.valorAPagar)}
            </Dado>
            <Dado rotulo="Última devolução">{formatDate(c.returnedDate)}</Dado>
          </dl>
          {c.notes && (
            <p className="mt-4 border-t border-border/70 pt-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              Obs.: {c.notes}
            </p>
          )}
        </Card>

        <AcoesHigienizacao
          id={c.id}
          caixasAReceber={c.caixasAReceber}
          valorAPagar={Number(c.valorAPagar)}
          cleanerName={c.cleanerName}
        />

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
            Movimentação de caixas ({c.movimentos.length})
          </h2>
          {c.movimentos.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              Nenhum movimento de estoque vinculado a este envio.
            </Card>
          ) : (
            <Card className="divide-y divide-border/70">
              {c.movimentos.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <span className="block font-semibold">{CRATE_MOVEMENT_LABELS[m.type]}</span>
                    <span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {formatDate(m.movementDate)}
                      {m.notes ? ` · ${m.notes}` : ""}
                    </span>
                  </div>
                  <span className="shrink-0 text-lg font-bold tabular-nums">{m.quantity}</span>
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

/** Um número do lote: rótulo pequeno em cima, valor em destaque embaixo. */
function Dado({
  rotulo,
  className,
  children,
}: {
  rotulo: string;
  /** Cor do valor — só para estado (falta receber, pago, a pagar). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{rotulo}</dt>
      <dd className={cn("font-bold tabular-nums [overflow-wrap:anywhere]", className)}>
        {children}
      </dd>
    </div>
  );
}
