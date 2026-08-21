import { notFound } from "next/navigation";
import { Container } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { FiadoService } from "@/lib/services/fiado.service";
import { formatBRL, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, RECIPIENT_TYPE_LABELS, SALE_UNIT_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PagamentoForm } from "./_components/pagamento-form";
import { DevolucaoCaixasForm } from "./_components/devolucao-caixas-form";
import { FiadoEditarForm } from "./_components/fiado-editar-form";

export const dynamic = "force-dynamic";

export default async function FiadoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const conta = await FiadoService.get(tenantId, id).catch(() => null);
  if (!conta) notFound();

  const pago = conta.status === "PAGO";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={conta.customerName}
        description={`Venda de ${formatDate(conta.saleDate)} · ${PAYMENT_METHOD_LABELS[conta.paymentMethod]}`}
      />

      <Card>
        <CardContent className="grid grid-cols-3 gap-2 pt-4 text-center">
          <div>
            <span className="block text-xs text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">{formatBRL(conta.totalAmount)}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Pago</span>
            <span className="font-semibold tabular-nums text-success">
              {formatBRL(conta.paidAmount)}
            </span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Saldo</span>
            <span className="font-semibold tabular-nums text-warning">
              {formatBRL(conta.saldo)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Itens da venda que originou o fiado */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produtos vendidos</CardTitle>
        </CardHeader>
        <CardContent>
          {conta.itens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este lançamento não tem venda vinculada com itens.
            </p>
          ) : (
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
                {conta.itens.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>
                      <span className="font-medium">{it.productName}</span>
                      {it.recipientType && (
                        <span className="block text-xs text-muted-foreground">
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
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatBRL(it.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total da compra</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(conta.totalAmount)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Caixas plásticas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Container className="size-4" /> Caixas plásticas
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div>
              <span className="block text-xs text-muted-foreground">Saíram nesta venda</span>
              <span className="font-semibold tabular-nums">{conta.plasticCrateQty}</span>
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">
                Saldo com o cliente
              </span>
              <span className="font-semibold tabular-nums text-warning">
                {conta.caixasComCliente}
              </span>
            </div>
          </div>
          {conta.caixasComCliente > 0 ? (
            <DevolucaoCaixasForm
              accountId={conta.id}
              maximo={conta.caixasComCliente}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma caixa pendente com este cliente.
            </p>
          )}
        </CardContent>
      </Card>

      {pago ? (
        <Badge variant="success" className="self-start">
          Conta quitada
        </Badge>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar pagamento</CardTitle>
          </CardHeader>
          <CardContent>
            <PagamentoForm accountId={conta.id} saldo={Number(conta.saldo)} />
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          Pagamentos ({conta.payments.length})
        </h2>
        {conta.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pagamento ainda.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {conta.payments.map((p) => (
              <Card key={p.id} className="flex items-center justify-between p-3 text-sm">
                <span>
                  {formatDateTime(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method]}
                </span>
                <span className="font-semibold tabular-nums">{formatBRL(p.amount)}</span>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da conta</CardTitle>
        </CardHeader>
        <CardContent>
          <FiadoEditarForm
            initial={{
              id: conta.id,
              customerPhone: conta.customerPhone,
              dueDate: conta.dueDate ? conta.dueDate.toISOString().slice(0, 10) : null,
              notes: conta.notes,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
