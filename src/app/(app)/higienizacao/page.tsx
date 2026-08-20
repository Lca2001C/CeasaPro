import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { HigienizacaoService } from "@/lib/services/higienizacao.service";
import { higienizacaoStatusEnum } from "@/lib/validations/higienizacao";
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

const FILTROS = [
  { value: "", label: "Todos" },
  { value: "ENVIADO", label: "Enviados" },
  { value: "DEVOLVIDO", label: "Devolvidos" },
  { value: "PAGO", label: "Pagos" },
] as const;

export default async function HigienizacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = higienizacaoStatusEnum.safeParse(rawStatus).data;

  const { tenantId } = await requireTenant();
  const { registros, caixasAReceber, totalAPagar, saldo } =
    await HigienizacaoService.list(tenantId, status);

  return (
    <div>
      <PageHeader
        title="Higienização"
        description="Fila de lavagem das caixas e o financeiro do serviço."
        action={
          <Button asChild size="sm">
            <Link href="/higienizacao/nova">
              <Plus /> Novo envio
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard
          label="Sujas"
          value={String(saldo.sujas)}
          hint="Aguardando lavagem"
          tone="warning"
        />
        <StatCard
          label="Em higienização"
          value={String(saldo.emHigienizacao)}
          hint="Com o higienizador"
        />
        <StatCard
          label="Limpas"
          value={String(saldo.limpas)}
          hint="Prontas para vender"
          tone="success"
        />
        <StatCard label="Com clientes" value={String(saldo.comClientes)} />
        <StatCard label="Caixas a receber" value={String(caixasAReceber)} tone="warning" />
        <StatCard label="Total a pagar" value={formatBRL(totalAPagar)} tone="destructive" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={(status ?? "") === f.value ? "default" : "outline"}
          >
            <Link href={f.value ? `/higienizacao?status=${f.value}` : "/higienizacao"}>
              {f.label}
            </Link>
          </Button>
        ))}
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
