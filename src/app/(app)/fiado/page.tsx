import Link from "next/link";
import { ChevronRight, Plus, Container } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { FiadoService } from "@/lib/services/fiado.service";
import { fiadoStatusFiltroEnum, type FiadoStatusFiltro } from "@/lib/validations/fiado";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const FILTROS: { value: FiadoStatusFiltro; label: string }[] = [
  { value: "EM_ABERTO", label: "Em aberto" },
  { value: "PAGO", label: "Pagas" },
  { value: "TODAS", label: "Todas" },
];

export default async function FiadoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = fiadoStatusFiltroEnum.safeParse(rawStatus).data ?? "EM_ABERTO";

  const { tenantId } = await requireTenant();
  const { contas, totalGeral, totalCaixas } = await FiadoService.listOpen(tenantId, status);

  return (
    <div>
      <PageHeader
        title="Fiado"
        description="Contas a receber dos clientes."
        action={
          <Button asChild size="sm">
            <Link href="/fiado/novo">
              <Plus /> Novo fiado
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard label="Total a receber" value={formatBRL(totalGeral)} tone="warning" />
        <StatCard
          label="Caixas com clientes"
          value={String(totalCaixas)}
          hint="Contas em aberto"
          icon={<Container className="size-4" />}
        />
      </div>

      <div className="mb-4 flex gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={status === f.value ? "default" : "outline"}
          >
            <Link href={`/fiado?status=${f.value}`}>{f.label}</Link>
          </Button>
        ))}
      </div>

      {contas.length === 0 ? (
        <EmptyState
          title={status === "PAGO" ? "Nenhuma conta quitada" : "Nenhuma conta em aberto"}
          description="Vendas na forma Fiado aparecem aqui para você controlar o recebimento."
          action={
            <Button asChild>
              <Link href="/fiado/novo">
                <Plus /> Lançar fiado
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {contas.map((c) => (
            <Link key={c.id} href={`/fiado/${c.id}`}>
              <Card className="flex items-center justify-between p-3 hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.customerName}</span>
                    {c.status === "PAGO" && <Badge variant="success">Quitada</Badge>}
                    {c.plasticCrateQty > 0 && (
                      <Badge variant="secondary">{c.plasticCrateQty} cx</Badge>
                    )}
                  </div>
                  <span className="block text-xs text-muted-foreground">
                    Venda {formatDate(c.saleDate)}
                    {c.dueDate ? ` · vence ${formatDate(c.dueDate)}` : " · sem vencimento"}
                    {c.caixasComCliente > 0
                      ? ` · ${c.caixasComCliente} caixa(s) a devolver`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span
                      className={cn(
                        "block font-semibold tabular-nums",
                        c.status === "PAGO" ? "text-success" : "text-warning",
                      )}
                    >
                      {formatBRL(c.saldo)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      de {formatBRL(c.totalAmount)}
                    </span>
                  </div>
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
