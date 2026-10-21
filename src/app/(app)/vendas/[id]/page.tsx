import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, ChevronRight, Container, Package } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { VendasService, HORAS_PARA_CANCELAR } from "@/lib/services/vendas.service";
import { dentroDoPrazoDeDesfazer } from "@/lib/desfazer/prazo";
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
import { IconeRedondo } from "@/components/ui/icone-redondo";
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
import { CheckboxRetirada } from "../_components/checkbox-retirada";

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
    <div>
      <PageHeader
        title={venda.customerName || "Venda avulsa"}
        description={`${formatDateTime(venda.saleDate)} · ${
          misto ? "Pagamento misto" : PAYMENT_METHOD_LABELS[venda.paymentMethod]
        }`}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/vendas">
              <ArrowLeft className="size-4" /> Voltar
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-5">
        {cancelada && (
          <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4 text-sm">
            <IconeRedondo tom="destructive" tamanho="sm">
              <Ban />
            </IconeRedondo>
            <span className="min-w-0">
              <b className="block text-base">
                Venda cancelada em {formatDateTime(venda.cancelledAt)}
              </b>
              {venda.cancelledReason
                ? `Motivo: ${venda.cancelledReason}`
                : "Sem motivo informado."}{" "}
              Ela não entra em faturamento, lucro nem fluxo de caixa; o estoque já foi devolvido.
            </span>
          </Card>
        )}

        {venda.cancelledAt === null && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="text-sm">
              <b className="block">Retirada</b>
              <span className="text-muted-foreground">
                {venda.retirarDepois
                  ? venda.retiradoEm
                    ? `Buscado em ${formatDateTime(venda.retiradoEm)}`
                    : "O cliente vai buscar mais tarde"
                  : "Levou na hora"}
              </span>
            </span>
            {venda.retirarDepois && (
              <CheckboxRetirada
                vendaId={venda.id}
                retirado={venda.retiradoEm !== null}
                cliente={venda.customerName || "Cliente"}
              />
            )}
          </Card>
        )}

        {/* Itens */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Produtos</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2 sm:px-5 sm:pb-5">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
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
                      <span className="font-semibold">{it.product.name}</span>
                      {(it.recipientType || Number(it.discountAmount) > 0) && (
                        <span className="block text-sm text-muted-foreground">
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
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatBRL(it.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                {(desconto > 0 || descontoItens > 0) && (
                  <>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={3}>Subtotal</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBRL(venda.subtotalAmount)}
                      </TableCell>
                    </TableRow>
                    <TableRow className="hover:bg-transparent">
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
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="font-semibold">
                    Total da venda
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {formatBRL(venda.totalAmount)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        {/* Pagamento */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pagamento</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {venda.payments.length === 0 ? (
              <div className="flex items-center justify-between gap-3">
                <span>{PAYMENT_METHOD_LABELS[venda.paymentMethod]}</span>
                <span className="font-bold tabular-nums">{formatBRL(venda.totalAmount)}</span>
              </div>
            ) : (
              venda.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3">
                  <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                  <span className="font-bold tabular-nums">{formatBRL(p.amount)}</span>
                </div>
              ))
            )}

            {venda.amountReceived != null && (
              <div className="mt-1 flex flex-col gap-1 border-t border-border/60 pt-3 text-sm">
                <div className="flex items-center justify-between gap-3 text-muted-foreground">
                  <span>Cliente pagou com</span>
                  <span className="tabular-nums">{formatBRL(venda.amountReceived)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Troco</span>
                  <span className="font-semibold tabular-nums">
                    {formatBRL(venda.changeGiven ?? 0)}
                  </span>
                </div>
              </div>
            )}

            {venda.customerPhone && (
              <p className="border-t border-border/60 pt-3 text-sm text-muted-foreground">
                Telefone do cliente: {formatPhone(venda.customerPhone)}
              </p>
            )}

            {venda.creditAccount && (
              <Link
                href={`/fiado/${venda.creditAccount.id}`}
                className="mt-1 inline-flex min-h-11 items-center gap-1 self-start rounded-md font-semibold text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Ver conta no fiado ({formatBRL(venda.creditAccount.totalAmount)}){" "}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            )}
          </CardContent>
        </Card>

        {/* O que a venda mexeu: é isto que responde "o estoque baixou mesmo?". */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">O que esta venda movimentou</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {venda.movimentosEstoque.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum movimento de estoque registrado.
              </p>
            ) : (
              venda.movimentosEstoque.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <IconeRedondo tom="neutro" tamanho="sm">
                      <Package />
                    </IconeRedondo>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.product.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {m.type === "SAIDA" ? "saída" : "devolução (cancelamento)"}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatQty(m.quantity)}
                  </span>
                </div>
              ))
            )}

            {venda.crateMovements.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-3">
                  <IconeRedondo tom="neutro" tamanho="sm">
                    <Container />
                  </IconeRedondo>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {CRATE_MOVEMENT_LABELS[m.type]}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {formatDate(m.movementDate)}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{m.quantity}</span>
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
            <p className="px-1 text-sm text-muted-foreground">
              {venda.creditAccount &&
              venda.creditAccount.payments.length > 0 &&
              dentroDoPrazoDeDesfazer(venda.createdAt) ? (
                <>
                  Esta venda fiada tem recebimento lançado. Para cancelá-la, estorne o recebimento
                  na{" "}
                  <Link href={`/fiado/${venda.creditAccount.id}`} className="text-primary underline">
                    tela do fiado
                  </Link>{" "}
                  (até {HORAS_PARA_CANCELAR} h depois de lançado) e volte aqui.
                </>
              ) : (
                `Passou o prazo de ${HORAS_PARA_CANCELAR} h para cancelar: esta venda já está no ` +
                "fechamento do dia em que foi feita e continua contando nele."
              )}
            </p>
          )
        )}

        {!cancelada && (
          <Badge variant="secondary" className="self-start">
            Venda registrada
          </Badge>
        )}
      </div>
    </div>
  );
}
