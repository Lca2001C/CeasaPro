import { paginaDaUrl } from "@/lib/paginacao";
import { CartaoDeAcao } from "@/components/ui/cartao-de-acao";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ban, ChevronRight, Clock, Package, PackageCheck, Plus, ReceiptText, Search } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { VendasService, VENDAS_POR_PAGINA } from "@/lib/services/vendas.service";
import { formatBRL, formatDateTime, formatQty } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { VendaFiltro, VendaFiltroPreset } from "@/lib/validations/venda";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { IconeRedondo } from "@/components/ui/icone-redondo";
import { cn } from "@/lib/cn";
import { publicUrl } from "@/lib/storage/r2";
import { CheckboxRetirada } from "./_components/checkbox-retirada";
import { ClientesLista } from "./_components/clientes-lista";
import { ClientesService } from "@/lib/services/clientes.service";

export const dynamic = "force-dynamic";

const PRESETS: { value: VendaFiltroPreset; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "7 dias" },
  { value: "mes", label: "Este mês" },
  { value: "todas", label: "Todas" },
];

const FORMAS = ["DINHEIRO", "PIX", "CARTAO", "FIADO"] as const;

interface Query {
  aba?: string;
  periodo?: string;
  q?: string;
  forma?: string;
  canceladas?: string;
  retirada?: string;
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
  const pagina = paginaDaUrl(sp.pagina);

  const { tenantId } = await requireTenant();
  const agora = new Date();

  // Vendas e Clientes são uma tela só, em abas (como Produtos | Compras no
  // Estoque): o cliente é quem aparece nas vendas, e a ficha dele é a lista
  // de vendas dele.
  if (sp.aba === "clientes") {
    const clientes = await ClientesService.list(tenantId, sp.q);
    return (
      <div>
        <CabecalhoDeVendas aba="clientes" />
        <ClientesLista clientes={clientes} q={sp.q} />
      </div>
    );
  }

  const filtro: VendaFiltro = {
    preset,
    q: sp.q?.trim() || undefined,
    paymentMethod: FORMAS.includes(sp.forma as (typeof FORMAS)[number])
      ? (sp.forma as (typeof FORMAS)[number])
      : undefined,
    incluirCanceladas: sp.canceladas === "1" || undefined,
    aguardandoRetirada: sp.retirada === "pendente" || undefined,
  };

  const skip = (pagina - 1) * VENDAS_POR_PAGINA;
  const [vendas, total, totais, aguardando] = await Promise.all([
    VendasService.list(tenantId, { ...filtro, skip }, agora),
    VendasService.count(tenantId, filtro, agora),
    VendasService.totaisDoFiltro(tenantId, filtro, agora),
    VendasService.aguardandoRetirada(tenantId),
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
      <CabecalhoDeVendas aba="vendas" />

      <div className="flex flex-col gap-5">
        {/* Totais DO RECORTE, não do histórico inteiro: a pergunta é sempre
            "quanto vendi hoje / nesta semana", e o número tem de bater com a
            lista que está logo abaixo. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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

        <div className="flex flex-col gap-3">
          <nav aria-label="Período" className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.value}
                asChild
                size="sm"
                variant={preset === p.value ? "default" : "outline"}
              >
                <Link
                  href={comFiltros({ periodo: p.value, pagina: "1" })}
                  aria-current={preset === p.value ? "page" : undefined}
                >
                  {p.label}
                </Link>
              </Button>
            ))}
          </nav>

          {/* Busca por cliente: "quanto vendi pro João ontem?" é a pergunta que a
              lista fixa de 100 vendas não respondia. */}
          <form action="/vendas" className="flex gap-2">
            <input type="hidden" name="periodo" value={preset} />
            {filtro.paymentMethod && (
              <input type="hidden" name="forma" value={filtro.paymentMethod} />
            )}
            {sp.canceladas === "1" && <input type="hidden" name="canceladas" value="1" />}
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-11"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="Buscar pelo nome do cliente..."
                aria-label="Buscar venda pelo cliente"
              />
            </div>
            <Button type="submit" variant="outline" className="shrink-0">
              Buscar
            </Button>
          </form>

          {(aguardando.length > 0 || filtro.aguardandoRetirada) && (
            <Link
              href={comFiltros({
                retirada: filtro.aguardandoRetirada ? undefined : "pendente",
                // Quem vem buscar pode ter comprado em qualquer dia.
                periodo: filtro.aguardandoRetirada ? undefined : "todas",
                pagina: "1",
              })}
              aria-current={filtro.aguardandoRetirada ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium",
                filtro.aguardandoRetirada
                  ? "border-warning bg-warning/15 text-warning"
                  : "border-warning/50 bg-warning/5 hover:bg-warning/10",
              )}
            >
              <Clock className="size-4 shrink-0" />
              {filtro.aguardandoRetirada
                ? "Mostrando só quem vai buscar — toque para ver todas"
                : `${aguardando.length} venda(s) aguardando o cliente buscar`}
            </Link>
          )}

          <nav aria-label="Forma de pagamento" className="flex flex-wrap gap-2">
            <Button
              asChild
              size="sm"
              variant={!filtro.paymentMethod ? "secondary" : "ghost"}
            >
              <Link
                href={comFiltros({ forma: undefined, pagina: "1" })}
                aria-current={!filtro.paymentMethod ? "page" : undefined}
              >
                Todas as formas
              </Link>
            </Button>
            {FORMAS.map((f) => (
              <Button
                key={f}
                asChild
                size="sm"
                variant={filtro.paymentMethod === f ? "secondary" : "ghost"}
              >
                <Link
                  href={comFiltros({ forma: f, pagina: "1" })}
                  aria-current={filtro.paymentMethod === f ? "page" : undefined}
                >
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
          </nav>
        </div>

        {vendas.length === 0 ? (
          <EmptyState
            title="Nenhuma venda no período"
            description={
              filtro.q
                ? `Nada encontrado para "${filtro.q}". Tente outro período ou outro nome.`
                : "Toque em Nova venda para abrir a frente de caixa."
            }
            icon={<ReceiptText />}
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
              const fotos = v.items
                .map((i) => ({ nome: i.product.name, url: publicUrl(i.product.imageKey) }))
                .filter((f, idx, arr) => arr.findIndex((o) => o.nome === f.nome) === idx);
              const resumo = v.items
                .map((i) => `${formatQty(i.quantity)} ${i.product.name}`)
                .join(", ");
              const cliente = v.customerName || "Cliente";
              return (
                <Card
                  key={v.id}
                  className="flex flex-col gap-3 p-4 motion-safe:transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  {/* O link cobre os dados da venda; o checkbox fica fora dele —
                      controle dentro de link é clique ambíguo. */}
                  <Link
                    href={`/vendas/${v.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {cancelada ? (
                      <IconeRedondo tom="destructive">
                        <Ban />
                      </IconeRedondo>
                    ) : (
                      <FotosDaVenda fotos={fotos} />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={cn(
                            "min-w-0 font-semibold [overflow-wrap:anywhere]",
                            cancelada && "line-through opacity-70",
                          )}
                        >
                          {cliente}
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
                      {/* O que foi vendido, por extenso: quem vem buscar diz
                          "as 3 caixas de tomate", não o número da venda. */}
                      <span className="line-clamp-2 text-sm [overflow-wrap:anywhere]">{resumo}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(v.saleDate)} · {v.items.length} item(ns)
                        {Number(v.discountAmount) > 0
                          ? ` · desconto ${formatBRL(v.discountAmount)}`
                          : ""}
                      </span>
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    {!cancelada &&
                      (v.retirarDepois ? (
                        <CheckboxRetirada
                          vendaId={v.id}
                          retirado={v.retiradoEm !== null}
                          cliente={cliente}
                        />
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <PackageCheck className="size-4" /> Levou na hora
                        </span>
                      ))}
                    <Link
                      href={`/vendas/${v.id}`}
                      className="flex items-center gap-1"
                      aria-label={`Abrir venda de ${cliente}`}
                    >
                      <span
                        className={cn(
                          "font-bold tabular-nums",
                          cancelada && "line-through opacity-70",
                        )}
                      >
                        {formatBRL(v.totalAmount)}
                      </span>
                      <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {ultimaPagina > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {pagina > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={comFiltros({ pagina: String(pagina - 1) })}>Anterior</Link>
              </Button>
            ) : (
              <span />
            )}
            <span className="text-sm text-muted-foreground">
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
    </div>
  );
}

/** Miniaturas dos produtos da venda (até 3, sobrepostas); sem foto, um ícone. */
function FotosDaVenda({ fotos }: { fotos: { nome: string; url: string | null }[] }) {
  const mostradas = fotos.slice(0, 3);
  const resto = fotos.length - mostradas.length;
  return (
    <span className="relative flex shrink-0 items-center">
      {mostradas.map((f, idx) => (
        <span
          key={f.nome}
          title={f.nome}
          className={cn(
            "flex size-12 items-center justify-center overflow-hidden rounded-lg border-2 border-card bg-muted",
            idx > 0 && "-ml-5",
          )}
        >
          {f.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- miniatura direto do bucket público
            <img src={f.url} alt={f.nome} className="size-full object-cover" loading="lazy" />
          ) : (
            <Package aria-hidden className="size-5 text-muted-foreground" />
          )}
        </span>
      ))}
      {resto > 0 && (
        <span className="-ml-3 flex size-7 items-center justify-center rounded-full border-2 border-card bg-secondary text-[11px] font-bold">
          +{resto}
        </span>
      )}
    </span>
  );
}

function CabecalhoDeVendas({ aba }: { aba: "vendas" | "clientes" }) {
  return (
    <>
      <PageHeader
        title="Vendas e clientes"
        description="Histórico de vendas e tudo o que cada cliente já comprou."
      />

      <CartaoDeAcao
        href="/vendas/nova"
        titulo="Registrar Nova Venda"
        descricao="Abra a frente de caixa e venda no balcão"
      />

      <div
        className="mb-4 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm font-medium"
        role="tablist"
      >
        <Link
          href="/vendas"
          role="tab"
          aria-selected={aba === "vendas"}
          className={cn(
            "rounded-md px-3 py-2 text-center",
            aba === "vendas" ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
        >
          Vendas
        </Link>
        <Link
          href="/vendas?aba=clientes"
          role="tab"
          aria-selected={aba === "clientes"}
          className={cn(
            "rounded-md px-3 py-2 text-center",
            aba === "clientes" ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
        >
          Clientes
        </Link>
      </div>
    </>
  );
}
