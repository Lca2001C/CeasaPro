import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Package, PackageCheck, Phone, Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { ClientesService } from "@/lib/services/clientes.service";
import { publicUrl } from "@/lib/storage/r2";
import { formatBRL, formatDateTime, formatQty } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { CheckboxRetirada } from "../../_components/checkbox-retirada";

export const dynamic = "force-dynamic";

export default async function ClientePage({ params }: { params: Promise<{ chave: string }> }) {
  const { chave } = await params;
  const { tenantId } = await requireTenant();
  const cliente = await ClientesService.detalhe(tenantId, decodeURIComponent(chave));
  if (!cliente) notFound();

  return (
    <div className="flex flex-col gap-5">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href="/vendas?aba=clientes">
          <ArrowLeft /> Clientes
        </Link>
      </Button>

      <PageHeader title={cliente.nome} description="Todas as compras deste cliente." />

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="success">
          {/* O PDV não lê o cliente da URL; o nome vai no autocompletar. */}
          <Link href="/vendas/nova">
            <Plus /> Nova venda
          </Link>
        </Button>
        {cliente.telefone && (
          <Button asChild variant="outline">
            <a href={`tel:${cliente.telefone.replace(/\D/g, "")}`}>
              <Phone /> {cliente.telefone}
            </a>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total comprado" value={formatBRL(cliente.totalComprado)} tone="success" />
        <StatCard label="Compras" value={String(cliente.compras)} hint={`Ticket ${formatBRL(cliente.ticketMedio)}`} />
        <StatCard
          label="Fiado em aberto"
          value={formatBRL(cliente.fiadoEmAberto)}
          tone={Number(cliente.fiadoEmAberto) > 0 ? "warning" : "default"}
        />
        <StatCard
          label="A buscar"
          value={String(cliente.aguardandoRetirada)}
          hint="Vendas aguardando"
          tone={cliente.aguardandoRetirada > 0 ? "warning" : "default"}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Histórico de compras</h2>
        {cliente.vendas.map((v) => {
          const cancelada = v.cancelledAt !== null;
          return (
            <Card key={v.id} className={cn("flex flex-col gap-3 p-4", cancelada && "opacity-70")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/vendas/${v.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                  <span className="text-sm font-medium">{formatDateTime(v.saleDate)}</span>
                  {cancelada ? (
                    <Badge variant="destructive">Cancelada</Badge>
                  ) : (
                    <Badge variant={v.paymentMethod === "FIADO" ? "warning" : "secondary"}>
                      {v.payments.length > 1 ? "Misto" : PAYMENT_METHOD_LABELS[v.paymentMethod]}
                    </Badge>
                  )}
                </Link>
                <span className={cn("font-bold tabular-nums", cancelada && "line-through")}>
                  {formatBRL(v.totalAmount)}
                </span>
              </div>

              <ul className="flex flex-col gap-2">
                {v.items.map((i) => {
                  const foto = publicUrl(i.product.imageKey);
                  return (
                    <li key={i.id} className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                        {foto ? (
                          // eslint-disable-next-line @next/next/no-img-element -- miniatura direto do bucket público
                          <img src={foto} alt="" className="size-full object-cover" loading="lazy" />
                        ) : (
                          <Package aria-hidden className="size-4 text-muted-foreground" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                        {formatQty(i.quantity)} × {i.product.name}
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {formatBRL(i.lineTotal)}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {!cancelada && (
                <div className="flex justify-end">
                  {v.retirarDepois ? (
                    <CheckboxRetirada
                      vendaId={v.id}
                      retirado={v.retiradoEm !== null}
                      cliente={cliente.nome}
                    />
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <PackageCheck className="size-4" /> Levou na hora
                    </span>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </section>
    </div>
  );
}
