import Link from "next/link";
import {
  AlertTriangle,
  Package,
  Pencil,
  Plus,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
} from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { EstoqueService } from "@/lib/services/estoque.service";
import { ProdutosService } from "@/lib/services/produtos.service";
import { ComprasService } from "@/lib/services/compras.service";
import { excluirProduto } from "@/actions/produtos.actions";
import { publicUrl, r2Configurado } from "@/lib/storage/r2";
import { formatBRL, formatQty } from "@/lib/format";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import { nivelEstoque } from "@/lib/estoque/nivel";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { DeleteButton } from "@/components/crud/delete-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProdutoEditavel } from "@/components/produtos/produto-modal";
import { cn } from "@/lib/cn";
import { add } from "@/lib/money";
import { BuscaEstoque } from "./_components/busca-estoque";
import { ProdutosControle } from "./_components/produtos-controle";
import { ComprasLista } from "./_components/compras-lista";

export const dynamic = "force-dynamic";

const FILTROS = [
  { value: "TODOS", label: "Todos" },
  { value: "COM_SALDO", label: "Com estoque" },
  { value: "BAIXO", label: "Estoque baixo" },
  { value: "ZERADO", label: "Zerados" },
] as const;

type Filtro = (typeof FILTROS)[number]["value"];

/**
 * Controle de Estoque — a casa dos produtos.
 *
 * Produtos, Compras e Estoque eram três telas para um fluxo só: cadastrar o
 * produto, dar entrada e conferir o saldo. Agora o produto nasce aqui (modal
 * "Novo Produto", já com estoque inicial, preço e foto), a compra é registrada
 * daqui (`/estoque/compra`) e o histórico de compras é a aba ao lado.
 */
export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{
    filtro?: string;
    q?: string;
    aba?: string;
    novo?: string;
    editar?: string;
  }>;
}) {
  const sp = await searchParams;
  const aba = sp.aba === "compras" ? "compras" : "produtos";
  // Padrão "Todos": esta tela também é a lista de produtos, e o produto
  // recém-cadastrado sem estoque precisa aparecer.
  const filtro: Filtro = FILTROS.some((f) => f.value === sp.filtro)
    ? (sp.filtro as Filtro)
    : "TODOS";
  const busca = sp.q?.trim().toLowerCase() || "";

  const { tenantId } = await requireTenant();
  const [todas, produtos, compras] = await Promise.all([
    EstoqueService.getPositions(tenantId),
    ProdutosService.list(tenantId),
    aba === "compras" ? ComprasService.list(tenantId) : Promise.resolve(null),
  ]);
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const fotosDisponiveis = r2Configurado();

  // Os totais somam TUDO que tem saldo, independentemente do filtro e da busca:
  // os cards são o retrato do estoque, não do que está na tela.
  const nivelDe = (p: (typeof todas)[number]) => nivelEstoque(p.quantity, p.minStock);
  const comSaldo = todas.filter((p) => nivelDe(p) !== "zerado");
  const valorTotal = add(...comSaldo.map((p) => p.value));
  const acabando = comSaldo.filter((p) => nivelDe(p) === "acabando");

  const posicoes = todas
    .filter((p) => {
      const nivel = nivelDe(p);
      if (filtro === "COM_SALDO" && nivel === "zerado") return false;
      if (filtro === "BAIXO" && nivel !== "acabando") return false;
      if (filtro === "ZERADO" && nivel !== "zerado") return false;
      return true;
    })
    .filter((p) => !busca || p.name.toLowerCase().includes(busca));

  // Produto para o modal de edição: números simples (Decimal não atravessa
  // para o componente cliente). "Tem histórico" = já tem movimento de estoque —
  // compra, venda e ajuste geram movimento; o servidor confere de novo.
  const editaveis: ProdutoEditavel[] = produtos.map((p) => {
    const pos = todas.find((t) => t.productId === p.id);
    return {
      id: p.id,
      name: p.name,
      saleUnit: p.saleUnit,
      salePrice: p.salePrice == null ? null : Number(p.salePrice),
      minStock: p.minStock == null ? null : Number(p.minStock),
      imageKey: p.imageKey,
      imageUrl: publicUrl(p.imageKey),
      recipientType: p.recipientType,
      qtyPerRecipient: p.qtyPerRecipient == null ? null : Number(p.qtyPerRecipient),
      sackCapacity: p.sackCapacity == null ? null : Number(p.sackCapacity),
      active: p.active,
      temHistorico: Boolean(pos?.lastMovementAt),
    };
  });

  const linkFiltro = (f: Filtro) =>
    `/estoque?filtro=${f}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`;

  return (
    <div>
      <PageHeader
        title="Controle de Estoque"
        description="Seus produtos, quanto tem de cada um e quanto isso vale."
        action={
          <div className="flex gap-2">
            <Button asChild size="sm" data-tour="registrar-compra">
              <Link href="/estoque/compra">
                <ShoppingBag /> <span className="hidden sm:inline">Registrar</span> compra
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/estoque/ajuste">
                <SlidersHorizontal /> Ajuste
              </Link>
            </Button>
          </div>
        }
      />

      {/* Cartão "Adicionar Novo Produto": o caminho mais curto até vender. */}
      <Link
        href="/estoque?novo=1"
        scroll={false}
        data-tour="novo-produto"
        className="mb-4 flex items-center justify-between gap-3 rounded-xl border-2 border-primary/30 bg-gradient-to-r from-primary to-primary/80 p-4 text-primary-foreground shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-lg font-bold">Adicionar Novo Produto</span>
          <span className="block text-sm opacity-90">
            Cadastre com estoque inicial, preço de venda e foto
          </span>
        </span>
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20">
          <Plus className="size-6" />
        </span>
      </Link>

      <div
        className="mb-4 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm font-medium"
        role="tablist"
      >
        <Link
          href="/estoque"
          role="tab"
          aria-selected={aba === "produtos"}
          className={cn(
            "rounded-md px-3 py-2 text-center",
            aba === "produtos" ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
        >
          Produtos
        </Link>
        <Link
          href="/estoque?aba=compras"
          role="tab"
          aria-selected={aba === "compras"}
          className={cn(
            "rounded-md px-3 py-2 text-center",
            aba === "compras" ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
        >
          Compras
        </Link>
      </div>

      {aba === "compras" && compras ? (
        <ComprasLista compras={compras} />
      ) : (
        <>
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
                acabando:{" "}
                {acabando
                  .slice(0, 3)
                  .map((p) => p.name)
                  .join(", ")}
                {acabando.length > 3 ? "…" : ""}
              </span>
            </Card>
          )}

          <Card className="mb-4 flex flex-col gap-3 p-3">
            <BuscaEstoque />
            <div className="flex flex-wrap gap-2">
              {FILTROS.map((f) => (
                <Button
                  key={f.value}
                  asChild
                  size="sm"
                  variant={filtro === f.value ? "default" : "outline"}
                >
                  <Link href={linkFiltro(f.value)}>{f.label}</Link>
                </Button>
              ))}
            </div>
          </Card>

          {posicoes.length === 0 ? (
            <EmptyState
              title={busca ? "Nenhum produto encontrado" : "Nenhum produto aqui"}
              description={
                busca
                  ? "Tente outro nome ou troque o filtro."
                  : "Toque em Adicionar Novo Produto para cadastrar o primeiro."
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {posicoes.map((p) => {
                const produto = porId.get(p.productId);
                const nivel = nivelDe(p);
                const unidade = SALE_UNIT_LABELS[p.saleUnit] ?? "";
                const foto = publicUrl(produto?.imageKey);
                const inativo = produto && !produto.active;
                return (
                  <Card
                    key={p.productId}
                    className={cn(
                      "p-3",
                      nivel === "acabando" && "border-warning/50 bg-warning/5",
                      (nivel === "zerado" || inativo) && "opacity-80",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                        {foto ? (
                          // eslint-disable-next-line @next/next/no-img-element -- miniatura direto do bucket público
                          <img
                            src={foto}
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Package className="size-6 text-muted-foreground" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{p.name}</span>
                          {inativo && <Badge variant="secondary">Inativo</Badge>}
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
                        <span className="block text-xs text-muted-foreground">
                          {unidade}
                          {produto?.salePrice != null
                            ? ` · vende a ${formatBRL(produto.salePrice)}`
                            : ""}
                        </span>
                      </div>
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

                    {/* Ações escritas e coloridas, numa linha própria: no
                        celular, três botões com texto não cabem ao lado do nome. */}
                    <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                      {nivel !== "zerado" && !inativo && (
                        <Button asChild size="sm" variant="success">
                          <Link
                            href={`/vendas/nova?produto=${p.productId}`}
                            aria-label={`Vender ${p.name}`}
                          >
                            <ShoppingCart /> Vender
                          </Link>
                        </Button>
                      )}
                      <Button asChild size="sm" variant="info">
                        <Link
                          href={`/estoque?editar=${p.productId}`}
                          scroll={false}
                          aria-label={`Editar ${p.name}`}
                        >
                          <Pencil /> Editar
                        </Link>
                      </Button>
                      <DeleteButton
                        action={excluirProduto}
                        id={p.productId}
                        entityLabel={`o produto ${p.name}`}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <ProdutosControle
        produtos={editaveis}
        novo={sp.novo === "1"}
        editarId={sp.editar ?? null}
        fotosDisponiveis={fotosDisponiveis}
      />
    </div>
  );
}
