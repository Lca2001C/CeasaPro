import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus, Search } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { VendasService, VENDAS_POR_PAGINA } from "@/lib/services/vendas.service";
import { formatBRL, formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { VendaFiltro, VendaFiltroPreset } from "@/lib/validations/venda";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const PRESETS: { value: VendaFiltroPreset; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "7 dias" },
  { value: "mes", label: "Este mês" },
  { value: "todas", label: "Todas" },
];

const FORMAS = ["DINHEIRO", "PIX", "CARTAO", "FIADO"] as const;

interface Query {
  periodo?: string;
  q?: string;
  forma?: string;
  canceladas?: string;
  pagina?: string;
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const sp = await searchParams;
  const preset: VendaFiltroPreset = PRESETS.some((p) => p.value === sp.periodo)
    ? (sp.periodo as VendaFiltroPreset)
    : "hoje";
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  const { tenantId } = await requireTenant();
  const agora = new Date();

  const filtro: VendaFiltro = {
    preset,
    q: sp.q?.trim() || undefined,
    paymentMethod: FORMAS.includes(sp.forma as (typeof FORMAS)[number])
      ? (sp.forma as (typeof FORMAS)[number])
      : undefined,
    incluirCanceladas: sp.canceladas === "1" || undefined,
  };

  const skip = (pagina - 1) * VENDAS_POR_PAGINA;
  const [vendas, total, totais] = await Promise.all([
    VendasService.list(tenantId, { ...filtro, skip }, agora),
    VendasService.count(tenantId, filtro, agora),
    VendasService.totaisDoFiltro(tenantId, filtro, agora),
  ]);

  const comFiltros = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    return `/vendas?${q.toString()}`;
  };

  const ultimaPagina = Math.max(1, Math.ceil(total / VENDAS_POR_PAGINA));
  if (pagina > ultimaPagina && total > 0) {
    redirect(comFiltros({ pagina: String(ultimaPagina) }));
  }

  return (
    <div>
      <PageHeader
        title="Vendas"
        description="Histórico de vendas registradas."
        action={
          <Button asChild size="sm">
            <Link href="/vendas/nova">
              <Plus /> Nova venda
            </Link>
          </Button>
        }
      />

      {/* Totais DO RECORTE, não do histórico inteiro: a pergunta é sempre
          "quanto vendi hoje / nesta semana", e o número tem de bater com a
          lista que está logo abaixo. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard
          label="Total no período"
          value={formatBRL(totais.total)}
          hint={`${totais.quantidade} venda(s)`}
          tone="success"
        />
        <StatCard label="Descontos" value={formatBRL(totais.descontos)} hint="Concedidos" />
        <StatCard
          label="Ticket médio"
          value={formatBRL(
            totais.quantidade > 0 ? Number(totais.total) / totais.quantidade : 0,
          )}
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.value}
            asChild
            size="sm"
            variant={preset === p.value ? "default" : "outline"}
          >
            <Link href={comFiltros({ periodo: p.value, pagina: "1" })}>{p.label}</Link>
          </Button>
        ))}
      </div>

      {/* Busca por cliente: "quanto vendi pro João ontem?" é a pergunta que a
          lista fixa de 100 vendas não respondia. */}
      <form action="/vendas" className="mb-3 flex gap-2">
        <input type="hidden" name="periodo" value={preset} />
        {filtro.paymentMethod && <input type="hidden" name="forma" value={filtro.paymentMethod} />}
        {sp.canceladas === "1" && <input type="hidden" name="canceladas" value="1" />}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Buscar pelo nome do cliente..."
            aria-label="Buscar venda pelo cliente"
          />
        </div>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          asChild
          size="sm"
          variant={!filtro.paymentMethod ? "secondary" : "ghost"}
        >
          <Link href={comFiltros({ forma: undefined, pagina: "1" })}>Todas as formas</Link>
        </Button>
        {FORMAS.map((f) => (
          <Button
            key={f}
            asChild
            size="sm"
            variant={filtro.paymentMethod === f ? "secondary" : "ghost"}
          >
            <Link href={comFiltros({ forma: f, pagina: "1" })}>
              {PAYMENT_METHOD_LABELS[f]}
            </Link>
          </Button>
        ))}
        <Button asChild size="sm" variant={sp.canceladas === "1" ? "secondary" : "ghost"}>
          <Link
            href={comFiltros({
              canceladas: sp.canceladas === "1" ? undefined : "1",
              pagina: "1",
            })}
          >
            {sp.canceladas === "1" ? "Ocultar canceladas" : "Ver canceladas"}
          </Link>
        </Button>
      </div>

      {vendas.length === 0 ? (
        <EmptyState
          title="Nenhuma venda no período"
          description={
            filtro.q
              ? `Nada encontrado para "${filtro.q}". Tente outro período ou outro nome.`
              : "Toque em Nova venda para abrir a frente de caixa."
          }
          action={
            <Button asChild>
              <Link href="/vendas/nova">
                <Plus /> Nova venda
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {vendas.map((v) => {
            const cancelada = v.cancelledAt !== null;
            const misto = v.payments.length > 1;
            return (
              <Link key={v.id} href={`/vendas/${v.id}`}>
                <Card className="flex items-center justify-between gap-3 p-3 hover:bg-accent/40">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          cancelada ? "font-medium line-through opacity-70" : "font-medium"
                        }
                      >
                        {v.customerName || "Cliente"}
                      </span>
                      {cancelada ? (
                        <Badge variant="destructive">Cancelada</Badge>
                      ) : (
                        <Badge variant={v.paymentMethod === "FIADO" ? "warning" : "secondary"}>
                          {misto ? "Misto" : PAYMENT_METHOD_LABELS[v.paymentMethod]}
                        </Badge>
                      )}
                      {v.plasticCrateQty > 0 && (
                        <Badge variant="outline">{v.plasticCrateQty} cx</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(v.saleDate)} · {v.items.length} item(ns)
                      {Number(v.discountAmount) > 0
                        ? ` · desconto ${formatBRL(v.discountAmount)}`
                        : ""}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={
                        cancelada
                          ? "font-semibold tabular-nums line-through opacity-70"
                          : "font-semibold tabular-nums"
                      }
                    >
                      {formatBRL(v.totalAmount)}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {ultimaPagina > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          {pagina > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={comFiltros({ pagina: String(pagina - 1) })}>Anterior</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            Página {pagina} de {ultimaPagina} · {total} venda{total === 1 ? "" : "s"}
          </span>
          {pagina < ultimaPagina ? (
            <Button asChild variant="outline" size="sm">
              <Link href={comFiltros({ pagina: String(pagina + 1) })}>Próxima</Link>
            </Button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
