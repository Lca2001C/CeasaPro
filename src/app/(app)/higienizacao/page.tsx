import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { formatBRL, formatDate } from "@/lib/format";
import { CRATE_CLEANING_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = {
  ENVIADO: "warning",
  DEVOLVIDO: "secondary",
  PAGO: "success",
};

export default async function HigienizacaoPage() {
  const { tenantId } = await requireTenant();
  const { registros, caixasAReceber, totalAPagar } =
    await HigienizacaoService.list(tenantId);

  return (
    <div>
      <PageHeader
        title="Higienização"
        description="Caixas enviadas para higienização e o financeiro do serviço."
        action={
          <Button asChild size="sm">
            <Link href="/higienizacao/nova">
              <Plus /> Novo envio
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard label="Caixas a receber" value={String(caixasAReceber)} tone="warning" />
        <StatCard label="Total a pagar" value={formatBRL(totalAPagar)} tone="destructive" />
      </div>

      {registros.length === 0 ? (
        <EmptyState
          title="Nenhum envio registrado"
          description="Registre o envio de caixas para o higienizador."
          action={
            <Button asChild>
              <Link href="/higienizacao/nova">
                <Plus /> Novo envio
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {registros.map((c) => (
            <Link key={c.id} href={`/higienizacao/${c.id}`}>
              <Card className="flex items-center justify-between p-3 hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.cleanerName}</span>
                    <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>
                      {CRATE_CLEANING_STATUS_LABELS[c.status]}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(c.sentDate)} · {c.sentQty} enviada(s) · {c.returnedQty}{" "}
                    devolvida(s)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{formatBRL(c.totalAmount)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
