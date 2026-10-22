import { notFound } from "next/navigation";
import { CheckCircle2, Container, TrendingDown } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/plan/modules";
import { FiadoService } from "@/lib/services/fiado.service";
import { formatBRL, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, RECIPIENT_TYPE_LABELS, SALE_UNIT_LABELS } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { isoDateTz } from "@/lib/tz";
import { PagamentoForm } from "./_components/pagamento-form";
import { DevolucaoCaixasForm } from "./_components/devolucao-caixas-form";
import { FiadoEditarForm } from "./_components/fiado-editar-form";
import { CancelarVendaDoFiado } from "./_components/cancelar-venda-fiado";
import { EstornarRecebimentoButton } from "./_components/estornar-recebimento-button";
import { BaixarComoPerda, DesfazerBaixa } from "./_components/baixar-como-perda";
import { Badge } from "@/components/ui/badge";
import { HORAS_PARA_DESFAZER } from "@/lib/desfazer/prazo";

export const dynamic = "force-dynamic";

export default async function FiadoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId, session } = await requireTenant();
  // A devolução de caixas é uma action do módulo `caixas`: sem ele o cartão
  // mostraria um formulário que o servidor recusa.
  const comCaixas = isModuleEnabled(session.modules, "caixas");
  const conta = await FiadoService.get(tenantId, id, { caixas: comCaixas }).catch(() => null);
  if (!conta) notFound();

  const pago = conta.status === "PAGO";
  const perda = conta.status === "PERDA";

  return (
    <div>
      <PageHeader
        title={conta.customerName}
        description={`Venda de ${formatDate(conta.saleDate)} · ${PAYMENT_METHOD_LABELS[conta.paymentMethod]}`}
      />

      <div className="flex flex-col gap-5">
        {/* Total · Pago · Saldo, nesta ordem — a conta do caderno. Três
            colunas até em 320px: o valor quebra linha em vez de vazar. */}
        <Card className="grid grid-cols-3 divide-x divide-border/60 py-4">
          <div className="min-w-0 px-3 text-center">
            <span className="block text-sm text-muted-foreground">Total</span>
            <span className="font-bold tabular-nums [overflow-wrap:anywhere] sm:text-lg">
              {formatBRL(conta.totalAmount)}
            </span>
          </div>
          <div className="min-w-0 px-3 text-center">
            <span className="block text-sm text-muted-foreground">Pago</span>
            <span className="font-bold tabular-nums text-success [overflow-wrap:anywhere] sm:text-lg">
              {formatBRL(conta.paidAmount)}
            </span>
          </div>
          <div className="min-w-0 px-3 text-center">
            <span className="block text-sm text-muted-foreground">Saldo</span>
            <span
              className={cn(
                "font-bold tabular-nums [overflow-wrap:anywhere] sm:text-lg",
                pago ? "text-success" : perda ? "text-muted-foreground line-through" : "text-warning",
              )}
            >
              {formatBRL(conta.saldo)}
            </span>
          </div>
        </Card>

        {/* Itens da venda que originou o fiado */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Produtos vendidos</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2 sm:px-5 sm:pb-5">
            {conta.itens.length === 0 ? (
              <p className="px-3 pb-3 text-sm text-muted-foreground sm:px-0 sm:pb-0">
                Este lançamento não tem venda vinculada com itens.
              </p>
            ) : (
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
                  {conta.itens.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <span className="font-semibold">{it.productName}</span>
                        {it.recipientType && (
                          <span className="block text-sm text-muted-foreground">
                            {RECIPIENT_TYPE_LABELS[it.recipientType]}
                            {it.crateQty > 0 ? ` · ${it.crateQty} un.` : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(it.quantity)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {SALE_UNIT_LABELS[it.saleUnit]}
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
                {/* O rodapé fecha com os itens logo acima: total da VENDA, e não
                    só a parte fiada. Numa venda mista (parte paga no balcão) ou
                    com desconto na venda, "Total da compra" com o valor da conta
                    ficava abaixo de itens que somavam outro número. */}
                <TableFooter>
                  {Number(conta.descontoDaVenda ?? 0) > 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={3}>Desconto na venda</TableCell>
                      <TableCell className="text-right tabular-nums">
                        − {formatBRL(conta.descontoDaVenda ?? 0)}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="font-semibold">
                      Total da compra
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {formatBRL(conta.totalDaVenda)}
                    </TableCell>
                  </TableRow>
                  {Number(conta.pagoNoBalcao) > 0 && (
                    <>
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={3}>Pago no balcão</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(conta.pagoNoBalcao)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={3}>Ficou no fiado</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(conta.totalAmount)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Caixas plásticas */}
        {comCaixas && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3 text-base">
              <IconeRedondo tom="neutro" tamanho="sm">
                <Container />
              </IconeRedondo>
              Caixas plásticas
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <span className="block text-sm text-muted-foreground">Saíram nesta venda</span>
                <span className="text-2xl font-bold tabular-nums">{conta.plasticCrateQty}</span>
              </div>
              <div className="min-w-0">
                <span className="block text-sm text-muted-foreground">Saldo com o cliente</span>
                <span className="text-2xl font-bold tabular-nums text-warning">
                  {conta.caixasComCliente}
                </span>
              </div>
            </div>
            {conta.caixasComCliente > 0 ? (
              <DevolucaoCaixasForm accountId={conta.id} maximo={conta.caixasComCliente} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma caixa pendente com este cliente.
              </p>
            )}
          </CardContent>
        </Card>
        )}

        {pago ? (
          <Card className="flex items-center gap-3 border-success/40 bg-success/5 p-4">
            <IconeRedondo tom="success" tamanho="sm">
              <CheckCircle2 />
            </IconeRedondo>
            <span className="font-semibold">Conta quitada</span>
          </Card>
        ) : perda ? (
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <IconeRedondo tom="neutro" tamanho="sm">
                <TrendingDown />
              </IconeRedondo>
              <div className="min-w-0">
                <span className="block font-semibold">
                  Baixado como perda: {formatBRL(conta.writtenOffAmount ?? 0)}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {conta.writtenOffAt ? `Em ${formatDateTime(conta.writtenOffAt)}` : ""}
                  {conta.writtenOffReason ? ` — ${conta.writtenOffReason}` : ""}
                </span>
              </div>
            </div>
            {conta.podeDesfazerBaixa && <DesfazerBaixa accountId={conta.id} />}
            {/* O cliente apareceu para pagar: o recebimento entra no resultado
                do mês de hoje como "Recebido de fiado baixado". */}
            {Number(conta.saldo) > 0 && (
              <div className="flex flex-col gap-2 border-t pt-3">
                <span className="text-sm font-semibold">Recebi depois da baixa</span>
                <PagamentoForm accountId={conta.id} saldo={Number(conta.saldo)} />
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Registrar pagamento</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <PagamentoForm accountId={conta.id} saldo={Number(conta.saldo)} />
              {/* Saída para o fiado que não vai ser pago, depois do prazo de
                  cancelar a venda — ver `FiadoService.baixarComoPerda`. */}
              {!conta.podeCancelarVenda && Number(conta.saldo) > 0 && (
                <BaixarComoPerda
                  accountId={conta.id}
                  customerName={conta.customerName}
                  saldo={formatBRL(conta.saldo)}
                  semVenda={!conta.saleId}
                />
              )}
            </CardContent>
          </Card>
        )}

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
            Pagamentos ({conta.payments.filter((p) => !p.reversedAt).length})
          </h2>
          {conta.payments.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">Nenhum pagamento ainda.</Card>
          ) : (
            <Card className="divide-y divide-border/70 overflow-hidden">
              {conta.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                      {formatDateTime(p.paidAt)}
                      {p.reversedAt && <Badge variant="destructive">Estornado</Badge>}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reversedAt &&
                        ` · estornado em ${formatDateTime(p.reversedAt)}` +
                          (p.reversedReason ? ` — ${p.reversedReason}` : "")}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "font-bold tabular-nums",
                        p.reversedAt ? "text-muted-foreground line-through" : "text-success",
                      )}
                    >
                      {formatBRL(p.amount)}
                    </span>
                    {p.podeEstornar && (
                      <EstornarRecebimentoButton paymentId={p.id} valor={formatBRL(p.amount)} />
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dados da conta</CardTitle>
          </CardHeader>
          <CardContent>
            <FiadoEditarForm
              initial={{
                id: conta.id,
                customerPhone: conta.customerPhone,
                // `isoDateTz`, não `toISOString`: o campo é uma data civil e
                // precisa abrir com o dia que o usuário enxerga no Brasil.
                dueDate: conta.dueDate ? isoDateTz(conta.dueDate) : null,
                notes: conta.notes,
              }}
            />
          </CardContent>
        </Card>

        {conta.podeCancelarVenda ? (
          <CancelarVendaDoFiado
            accountId={conta.id}
            customerName={conta.customerName}
            itensCount={conta.itens.length}
            caixasDaVenda={conta.plasticCrateQty}
            pagoNoBalcao={Number(conta.pagoNoBalcao) > 0 ? formatBRL(conta.pagoNoBalcao) : null}
          />
        ) : perda ? null : (
          <p className="px-1 text-sm text-muted-foreground">
            {conta.vendaNoPrazo && conta.temRecebimentoVivo
              ? `Para cancelar esta venda, estorne antes os recebimentos (até ${HORAS_PARA_DESFAZER} h ` +
                "depois de lançados)."
              : `Passou o prazo de ${HORAS_PARA_DESFAZER} h para cancelar esta venda: ela já está no ` +
                "fechamento do dia em que foi feita."}
          </p>
        )}
      </div>
    </div>
  );
}
