import Link from "next/link";
import { ChevronRight, Clock, Search, Users } from "lucide-react";
import type { ClienteResumo } from "@/lib/services/clientes.service";
import { formatBRL, formatDate } from "@/lib/format";
import { EmptyState } from "@/components/data/empty-state";
import { StatCard } from "@/components/data/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const inicial = (nome: string) => (nome.trim()[0] ?? "?").toUpperCase();

/** Aba "Clientes" da tela de Vendas: quem compra e tudo o que já levou. */
export function ClientesLista({ clientes, q }: { clientes: ClienteResumo[]; q?: string }) {
  const aguardando = clientes.reduce((a, c) => a + c.aguardandoRetirada, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Clientes" value={String(clientes.length)} hint="Com compra registrada" />
        <StatCard
          label="Aguardando retirada"
          value={String(aguardando)}
          hint="Vendas a buscar"
          tone={aguardando > 0 ? "warning" : "default"}
        />
      </div>

      <form action="/vendas" className="flex gap-2">
        <input type="hidden" name="aba" value="clientes" />
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-11"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Buscar cliente pelo nome..."
            aria-label="Buscar cliente"
          />
        </div>
        <Button type="submit" variant="outline" className="shrink-0">
          Buscar
        </Button>
      </form>

      {clientes.length === 0 ? (
        <EmptyState
          title={q ? "Nenhum cliente encontrado" : "Nenhum cliente ainda"}
          description={
            q
              ? `Nada encontrado para "${q}".`
              : "O cliente aparece aqui quando você informa o nome dele numa venda."
          }
          icon={<Users />}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {clientes.map((c) => (
            <Link
              key={c.chave}
              href={`/vendas/clientes/${encodeURIComponent(c.chave)}`}
              className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="flex items-center justify-between gap-3 p-4 motion-safe:transition-colors hover:bg-muted/60">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary"
                  >
                    {inicial(c.nome)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold [overflow-wrap:anywhere]">{c.nome}</span>
                      {c.aguardandoRetirada > 0 && (
                        <Badge variant="warning" className="gap-1">
                          <Clock className="size-3" /> {c.aguardandoRetirada} a buscar
                        </Badge>
                      )}
                    </div>
                    <span className="block text-sm text-muted-foreground">
                      {c.compras} compra(s) · última em {formatDate(c.ultimaCompra)}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="font-bold tabular-nums">{formatBRL(c.totalComprado)}</span>
                  <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
