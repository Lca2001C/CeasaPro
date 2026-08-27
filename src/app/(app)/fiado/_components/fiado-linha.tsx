import type { SaleUnit } from "@prisma/client";
import { formatBRL, formatQty } from "@/lib/format";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import type { Numeric } from "@/lib/money";

export interface FiadoItemResumo {
  id: string;
  productName: string;
  saleUnit: SaleUnit;
  quantity: Numeric;
  unitPrice: Numeric;
  lineTotal: Numeric;
  crateQty: number;
}

/**
 * Resumo dos produtos de uma entrega fiada.
 *
 * A planilha que o cliente usa tem UMA linha por entrega, com produto,
 * quantidade e preço à vista. Quase toda venda tem um item só — nesse caso
 * mostramos os três dados na linha. Com vários itens, mostrar todos estouraria
 * a coluna, então some o "e mais N", e o detalhe fica a um toque de distância.
 */
export function ProdutosResumo({ itens }: { itens: FiadoItemResumo[] }) {
  if (itens.length === 0) {
    return <span className="text-xs text-muted-foreground">Sem itens vinculados</span>;
  }

  const [primeiro, ...resto] = itens;
  return (
    <span className="min-w-0">
      <span className="block truncate">{primeiro.productName}</span>
      {resto.length > 0 && (
        <span className="block text-xs text-muted-foreground">
          e mais {resto.length} produto(s)
        </span>
      )}
    </span>
  );
}

/** Quantidade do primeiro item, com a unidade de venda. Vazio se não houver itens. */
export function QuantidadeResumo({ itens }: { itens: FiadoItemResumo[] }) {
  const primeiro = itens[0];
  if (!primeiro) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums">
      {formatQty(primeiro.quantity)}
      <span className="ml-1 text-xs text-muted-foreground">
        {SALE_UNIT_LABELS[primeiro.saleUnit]}
      </span>
    </span>
  );
}

/**
 * Preço unitário. Com mais de um item os preços divergem, e mostrar só o do
 * primeiro seria enganoso — nesse caso a coluna fica vazia de propósito.
 */
export function PrecoResumo({ itens }: { itens: FiadoItemResumo[] }) {
  if (itens.length !== 1) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{formatBRL(itens[0].unitPrice)}</span>;
}
