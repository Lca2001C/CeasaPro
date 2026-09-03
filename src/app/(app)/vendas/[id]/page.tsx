import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, ChevronRight, Container, Package } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { VendasService, HORAS_PARA_CANCELAR } from "@/lib/services/vendas.service";
import { formatBRL, formatDate, formatDateTime, formatPhone, formatQty } from "@/lib/format";
import {
  CRATE_MOVEMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  RECIPIENT_TYPE_LABELS,
  SALE_UNIT_LABELS,
} from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CancelarVendaButton } from "./_components/cancelar-venda-button";

export const dynamic = "force-dynamic";

/**
 * Detalhe da venda.
 *
 * Existe para três situações reais: conferir o que foi vendido, resolver
 * discussão com o cliente ("eu não levei isso") e cancelar quando foi erro. Por
 * isso mostra também o que a venda MEXEU — estoque e caixas — e não só os itens.
 */
export default async function VendaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const venda = await VendasService.get(tenantId, id).catch(() => null);
  if (!venda) notFound();

  const cancelada = venda.cancelledAt !== null;
  const misto = venda.payments.length > 1;
  const desconto = Number(venda.discountAmount);
  const descontoItens = venda.items.reduce((a, i) => a + Number(i.discountAmount), 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={venda.customerName || "Venda avulsa"}
        description={`${formatDateTime(venda.saleDate)} · ${
          misto ? "Pagamento misto" : PAYMENT_METHOD_LABELS[venda.paymentMethod]
        }`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/vendas">
              <ArrowLeft className="size-4" /> Voltar
            </Link>
          </Button>
        }
      />

      {cancelada && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-2 pt-4 text-sm">
            <Ban className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              <b className="block">
                Venda cancelada em {formatDateTime(venda.cancelledAt)}
              </b>
              {venda.cancelledReason
                ? `Motivo: ${venda.cancelledReason}`
                : "Sem motivo informado."}{" "}
              Ela não entra em faturamento, lucro nem fluxo de caixa; o estoque já foi devolvido.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Itens */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produtos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço unit.</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venda.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <span className="font-medium">{it.product.name}</span>
                    {(it.recipientType || Number(it.discountAmount) > 0) && (
                      <span className="block text-xs text-muted-foreground">
                        {it.recipientType
                          ? `${RECIPIENT_TYPE_LABELS[it.recipientType]}${
                              it.crateQty > 0 ? ` · ${it.crateQty} un.` : ""
                            }`
                          : ""}
                        {Number(it.discountAmount) > 0
                          ? `${it.recipientType ? " · " : ""}desconto ${formatBRL(it.discountAmount)}`
                          : ""}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(it.quantity)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {SALE_UNIT_LABELS[it.product.saleUnit]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(it.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatBRL(it.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              {(desconto > 0 || descontoItens > 0) && (
                <>
                  <TableRow>
                    <TableCell colSpan={3}>Subtotal</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBRL(venda.subtotalAmount)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={3}>
                      Descontos
                      {venda.discountReason ? ` (${venda.discountReason})` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      − {formatBRL(desconto + descontoItens)}
                    </TableCell>
                  </TableRow>
                </>
              )}
              <TableRow>
                <TableCell colSpan={3}>Total da venda</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(venda.totalAmount)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {/* Pagamento */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pagamento</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {venda.payments.length === 0 ? (
            <div className="flex items-center justify-between">
              <span>{PAYMENT_METHOD_LABELS[venda.paymentMethod]}</span>
              <span className="font-semibold tabular-nums">{formatBRL(venda.totalAmount)}</span>
            </div>
          ) : (
            venda.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                <span className="font-semibold tabular-nums">{formatBRL(p.amount)}</span>
              </div>
            ))
          )}

          {venda.amountReceived != null && (
            <div className="mt-1 flex flex-col gap-1 border-t pt-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Cliente pagou com</span>
                <span className="tabular-nums">{formatBRL(venda.amountReceived)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Troco</span>
                <span className="font-semibold tabular-nums">
                  {formatBRL(venda.changeGiven ?? 0)}
                </span>
              </div>
            </div>
          )}

          {venda.customerPhone && (
            <p className="border-t pt-2 text-muted-foreground">
              Telefone do cliente: {formatPhone(venda.customerPhone)}
            </p>
          )}

          {venda.creditAccount && (
            <Link
              href={`/fiado/${venda.creditAccount.id}`}
              className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
            >
              Ver conta no fiado ({formatBRL(venda.creditAccount.totalAmount)}){" "}
              <ChevronRight className="size-3" />
            </Link>
          )}
        </CardContent>
      </Card>

      {/* O que a venda mexeu: é isto que responde "o estoque baixou mesmo?". */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que esta venda movimentou</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {venda.movimentosEstoque.length === 0 ? (
            <p className="text-muted-foreground">Nenhum movimento de estoque registrado.</p>
          ) : (
            venda.movimentosEstoque.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Package className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">
                    {m.product.name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {m.type === "SAIDA" ? "saída" : "devolução (cancelamento)"}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatQty(m.quantity)}</span>
              </div>
            ))
          )}

          {venda.crateMovements.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Container className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">
                  {CRATE_MOVEMENT_LABELS[m.type]}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {formatDate(m.movementDate)}
                  </span>
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{m.quantity}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {venda.podeCancelar ? (
        <CancelarVendaButton
          id={venda.id}
          total={formatBRL(venda.totalAmount)}
          temFiado={venda.creditAccount !== null}
          caixas={venda.plasticCrateQty}
        />
      ) : (
        !cancelada && (
          <p className="text-xs text-muted-foreground">
            {venda.creditAccount && venda.creditAccount.payments.length > 0
              ? "Esta venda fiada já teve recebimento. Para desfazê-la, estorne o pagamento no fiado primeiro."
              : `O cancelamento é permitido até ${HORAS_PARA_CANCELAR}h depois da venda. Para corrigir esta, faça um ajuste de estoque.`}
          </p>
        )
      )}

      {!cancelada && (
        <Badge variant="secondary" className="self-start">
          Venda registrada
        </Badge>
      )}
    </div>
  );
}
