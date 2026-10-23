import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { NotFoundError } from "@/lib/http/app-error";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { sub } from "@/lib/money";
import { formatBRL, formatDateTime, formatPhone } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, SALE_UNIT_LABELS } from "@/lib/labels";
import type { ReportResult } from "./report.types";

/**
 * Comprovante de UMA venda, no formato que os exportadores de PDF e Excel já
 * sabem desenhar: identificação no `cabecalho`, itens na tabela.
 *
 * As linhas da tabela somam o total da venda: cada item pelo `lineTotal` (já
 * com o desconto da linha) e o desconto da venda numa linha própria, negativa —
 * a mesma regra do extrato do cliente. Venda cancelada continua emitível, mas
 * sai marcada como cancelada no cabeçalho.
 *
 * Venda de outra empresa ou inexistente: `NotFoundError` (o `getTenantPrisma`
 * escopa a busca pelo `tenantId` da sessão).
 */
export async function buildComprovanteVenda(
  tenantId: string,
  saleId: string,
): Promise<ReportResult> {
  const venda = await getTenantPrisma(tenantId).sale.findFirst({
    where: { id: saleId },
    include: {
      items: {
        include: { product: { select: { name: true, saleUnit: true } } },
        orderBy: { createdAt: "asc" },
      },
      payments: { orderBy: { createdAt: "asc" } },
      creditAccount: { select: { totalAmount: true, paidAmount: true, status: true } },
    },
  });
  if (!venda) throw new NotFoundError("Venda não encontrada");

  const cabecalho: { rotulo: string; valor: string }[] = [
    { rotulo: "Cliente", valor: venda.customerName?.trim() || "Venda avulsa" },
    { rotulo: "Data", valor: formatDateTime(venda.saleDate) },
  ];
  if (venda.customerPhone) {
    cabecalho.push({ rotulo: "Telefone", valor: formatPhone(venda.customerPhone) });
  }
  // Venda antiga não tem parcelas gravadas: a forma é a da própria venda.
  const pagamento =
    venda.payments.length === 0
      ? `${PAYMENT_METHOD_LABELS[venda.paymentMethod]} ${formatBRL(venda.totalAmount)}`
      : venda.payments
          .map((pg) => `${PAYMENT_METHOD_LABELS[pg.method]} ${formatBRL(pg.amount)}`)
          .join(" + ");
  cabecalho.push({ rotulo: "Pagamento", valor: pagamento });
  if (venda.amountReceived != null) {
    cabecalho.push({
      rotulo: "Troco",
      valor: `${formatBRL(venda.changeGiven ?? 0)} (pagou com ${formatBRL(venda.amountReceived)})`,
    });
  }
  if (venda.creditAccount && venda.creditAccount.status === "EM_ABERTO") {
    cabecalho.push({
      rotulo: "Fiado em aberto",
      valor: formatBRL(
        FinancialCalc.saldoFiado(venda.creditAccount.totalAmount, venda.creditAccount.paidAmount),
      ),
    });
  }
  if (venda.cancelledAt) {
    cabecalho.push({
      rotulo: "Situação",
      valor: `CANCELADA em ${formatDateTime(venda.cancelledAt)}${
        venda.cancelledReason ? ` — ${venda.cancelledReason}` : ""
      }`,
    });
  }

  const rows: Record<string, unknown>[] = venda.items.map((it) => ({
    product: it.product.name,
    quantity: it.quantity,
    unit: SALE_UNIT_LABELS[it.product.saleUnit] ?? it.product.saleUnit,
    unitPrice: it.unitPrice,
    discount: it.discountAmount.greaterThan(0) ? it.discountAmount : null,
    lineTotal: it.lineTotal,
  }));
  if (venda.discountAmount.greaterThan(0)) {
    rows.push({
      product: venda.discountReason
        ? `Desconto da venda (${venda.discountReason})`
        : "Desconto da venda",
      lineTotal: sub(0, venda.discountAmount),
    });
  }

  return {
    title: venda.customerName?.trim()
      ? `Venda — ${venda.customerName.trim()}`
      : "Venda avulsa",
    period: { from: venda.saleDate, to: venda.saleDate },
    generatedAt: new Date(),
    cabecalho,
    columns: [
      { key: "product", label: "Produto" },
      { key: "quantity", label: "Qtd", align: "right", format: "qty" },
      { key: "unit", label: "Un." },
      { key: "unitPrice", label: "Preço", align: "right", format: "money" },
      { key: "discount", label: "Desconto", align: "right", format: "money" },
      { key: "lineTotal", label: "Total", align: "right", format: "money" },
    ],
    rows,
    totals: { product: "TOTAL", lineTotal: venda.totalAmount },
  };
}
