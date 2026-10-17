import Link from "next/link";
import { CalendarClock, Link2, Package } from "lucide-react";
import { formatBRL, formatDateOnly, formatQty, valorExibivel } from "@/lib/format";
import { nivelEstoque } from "@/lib/estoque/nivel";
import { rotuloDeEmbalagem } from "@/lib/cotacoes/embalagem";
import type { MeuProdutoNaCotacao } from "@/lib/services/cotacoes.service";

/**
 * Produto do cliente que NÃO tem linha no boletim de hoje.
 *
 * Dois casos, e o cartão diz qual é — sumir da tela calado é o que este cartão
 * existe para evitar:
 *  - vinculado, mas fora deste boletim: mostra o ÚLTIMO preço da praça com a
 *    data dele em destaque (nunca "ontem" — a praça não publica todo dia, e
 *    produto fora de safra some por semanas);
 *  - sem vínculo: convida a vincular, levando direto à linha do produto.
 */
export function CartaoMeuProduto({ produto }: { produto: MeuProdutoNaCotacao }) {
  const temSaldo = nivelEstoque(produto.saldo) !== "zerado";
  const saldo = temSaldo && (
    <p className="mt-2 flex items-center gap-1 border-t pt-2 text-[11px] text-muted-foreground">
      <Package className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">Você tem {formatQty(produto.saldo)}</span>
    </p>
  );

  if (!produto.vinculo) {
    return (
      <Link
        href={`/cotacoes/vincular#produto-${produto.produtoId}`}
        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="flex h-full flex-col rounded-lg border border-dashed bg-card p-3 shadow-sm transition-colors hover:border-primary/60 hover:bg-accent/40">
          <span className="self-start rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Sem cotação vinculada
          </span>
          <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-tight">{produto.nome}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Diga qual item do boletim é este produto para ver o preço da praça.
          </p>
          <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-semibold text-primary">
            <Link2 className="size-4" aria-hidden="true" />
            Vincular
          </span>
          {saldo}
        </div>
      </Link>
    );
  }

  const { vinculo, ultimo } = produto;
  return (
    <Link
      href={`/cotacoes/produto/${vinculo.ceasaProductId}${ultimo ? `?u=${encodeURIComponent(ultimo.unit)}` : ""}`}
      className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex h-full flex-col rounded-lg border border-success/30 bg-card p-3 shadow-sm transition-colors hover:border-success hover:bg-accent/40">
        <span className="inline-flex items-center gap-1 self-start rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
          <CalendarClock className="size-2.5" aria-hidden="true" />
          Não saiu hoje
        </span>
        <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-tight">{produto.nome}</p>
        <p className="text-xs uppercase text-muted-foreground [overflow-wrap:anywhere]">
          {vinculo.ceasaProductName}
          {vinculo.unit !== null && ` · ${rotuloDeEmbalagem(vinculo.unit)}`}
        </p>
        <div className="mt-auto pt-2">
          {ultimo ? (
            <>
              <p className="text-xl font-bold leading-none tabular-nums text-muted-foreground">
                {valorExibivel(formatBRL(ultimo.refPrice))}
              </p>
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                Último preço: boletim de {formatDateOnly(ultimo.quoteDate)}
                {vinculo.unit === null && ` (${rotuloDeEmbalagem(ultimo.unit)})`}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              A praça ainda não publicou preço deste item.
            </p>
          )}
        </div>
        {saldo}
      </div>
    </Link>
  );
}
