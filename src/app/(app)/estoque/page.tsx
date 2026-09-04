import Link from "next/link";
import { AlertTriangle, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { EstoqueService } from "@/lib/services/estoque.service";
import { formatBRL, formatQty } from "@/lib/format";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import { nivelEstoque } from "@/lib/estoque/nivel";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { add } from "@/lib/money";
import { BuscaEstoque } from "./_components/busca-estoque";

export const dynamic = "force-dynamic";

const FILTROS = [
  { value: "COM_SALDO", label: "Com estoque" },
  { value: "ZERADO", label: "Zerados" },
  { value: "TODOS", label: "Todos" },
] as const;

type Filtro = (typeof FILTROS)[number]["value"];

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; q?: string }>;
}) {
  const { filtro: rawFiltro, q } = await searchParams;
  // Padrão "com estoque": abrir numa lista cheia de zeros passa a impressão de
  // que não há mercadoria nenhuma.
  const filtro: Filtro = FILTROS.some((f) => f.value === rawFiltro)
    ? (rawFiltro as Filtro)
    : "COM_SALDO";
  const busca = q?.trim().toLowerCase() || "";

  const { tenantId } = await requireTenant();
  const todas = await EstoqueService.getPositions(tenantId);

  // Os totais somam TUDO que tem saldo, independentemente do filtro e da busca:
  // os cards são o retrato do estoque, não do que está na tela.
  const comSaldo = todas.filter((p) => nivelEstoque(p.quantity) !== "zerado");
  const valorTotal = add(...comSaldo.map((p) => p.value));

  const posicoes = todas
    .filter((p) => {
      const zerado = nivelEstoque(p.quantity) === "zerado";
      if (filtro === "COM_SALDO" && zerado) return false;
      if (filtro === "ZERADO" && !zerado) return false;
      return true;
    })
    .filter((p) => !busca || p.name.toLowerCase().includes(busca));

  const acabando = comSaldo.filter((p) => nivelEstoque(p.quantity) === "acabando");

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Quanto você tem de cada produto e quanto isso vale. Atualiza sozinho quando você compra ou vende."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/estoque/ajuste">
              <SlidersHorizontal /> Ajuste
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard
          label="Produtos com saldo"
          value={String(comSaldo.length)}
          hint={comSaldo.length === 1 ? "item" : "itens"}
        />
        <StatCard label="Valor em estoque" value={formatBRL(valorTotal)} />
      </div>

      {acabando.length > 0 && (
        <Card className="mb-4 flex items-center gap-2 border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span>
            <b>
              {acabando.length} produto{acabando.length > 1 ? "s" : ""}
            </b>{" "}
            acabando: {acabando.slice(0, 3).map((p) => p.name).join(", ")}
            {acabando.length > 3 ? "…" : ""}
          </span>
        </Card>
      )}

      <div className="mb-3">
        <BuscaEstoque />
      </div>

      <div className="mb-4 flex gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={filtro === f.value ? "default" : "outline"}
          >
            <Link href={`/estoque?filtro=${f.value}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`}>
              {f.label}
            </Link>
          </Button>
        ))}
      </div>

      {posicoes.length === 0 ? (
        <EmptyState
          title={busca ? "Nenhum produto encontrado" : "Nenhum produto no estoque"}
          description={
            busca
              ? "Tente outro nome ou troque o filtro."
              : "Cadastre produtos e registre compras para movimentar o estoque."
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {posicoes.map((p) => {
            const nivel = nivelEstoque(p.quantity);
            const unidade = SALE_UNIT_LABELS[p.saleUnit] ?? "";
            return (
              <Card
                key={p.productId}
                className={cn(
                  "p-3",
                  nivel === "acabando" && "border-warning/50 bg-warning/5",
                  nivel === "zerado" && "opacity-70",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    {nivel === "acabando" && (
                      <Badge variant="warning" className="shrink-0 gap-1">
                        <AlertTriangle className="size-3" /> Acabando
                      </Badge>
                    )}
                    {nivel === "zerado" && (
                      <Badge variant="secondary" className="shrink-0">
                        Sem estoque
                      </Badge>
                    )}
                  </span>
                  {nivel !== "zerado" && (
                    <Button asChild size="sm" variant="outline" className="shrink-0">
                      <Link href={`/vendas/nova?produto=${p.productId}`}>
                        <ShoppingCart className="size-4" />
                        <span className="hidden sm:inline">Vender</span>
                      </Link>
                    </Button>
                  )}
                </div>

                {/* Três leituras: quanto tem, quanto custou, quanto vale. */}
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="min-w-0">
                    <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                      Quantidade
                    </span>
                    <span
                      className={cn(
                        "text-lg font-bold tabular-nums [overflow-wrap:anywhere]",
                        nivel === "acabando" && "text-warning",
                        nivel === "zerado" && "text-muted-foreground",
                      )}
                    >
                      {formatQty(p.quantity)}
                    </span>
                    {unidade && (
                      <span className="block text-[11px] text-muted-foreground">{unidade}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                      Custo médio
                    </span>
                    <span className="text-sm font-medium tabular-nums [overflow-wrap:anywhere]">
                      {formatBRL(p.avgCost)}
                    </span>
                    {unidade && (
                      <span className="block text-[11px] text-muted-foreground">
                        por {unidade.toLowerCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                      Valor
                    </span>
                    <span className="text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">
                      {formatBRL(p.value)}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
