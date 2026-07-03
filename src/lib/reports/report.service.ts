import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { EstoqueService } from "@/lib/services/estoque.service";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { add } from "@/lib/money";
import {
  PAYMENT_METHOD_LABELS,
  EXPENSE_TYPE_LABELS,
  EXPENSE_STATUS_LABELS,
  CREDIT_STATUS_LABELS,
} from "@/lib/labels";
import type { ReportKind, ReportResult } from "./report.types";
import { REPORT_LABELS } from "./report.types";

interface Params {
  tenantId: string;
  from: Date;
  to: Date;
}

export async function buildReport(kind: ReportKind, p: Params): Promise<ReportResult> {
  const db = getTenantPrisma(p.tenantId);
  const base = {
    title: REPORT_LABELS[kind],
    period: { from: p.from, to: p.to },
    generatedAt: new Date(),
  };

  switch (kind) {
    case "VENDAS": {
      const vendas = await db.sale.findMany({
        where: { saleDate: { gte: p.from, lte: p.to } },
        orderBy: { saleDate: "asc" },
      });
      return {
        ...base,
        columns: [
          { key: "saleDate", label: "Data", format: "date" },
          { key: "customerName", label: "Cliente" },
          { key: "paymentMethod", label: "Pagamento" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
        ],
        rows: vendas.map((v) => ({
          saleDate: v.saleDate,
          customerName: v.customerName ?? "—",
          paymentMethod: PAYMENT_METHOD_LABELS[v.paymentMethod],
          totalAmount: v.totalAmount,
        })),
        totals: { customerName: "TOTAL", totalAmount: add(...vendas.map((v) => v.totalAmount)) },
      };
    }

    case "COMPRAS": {
      const compras = await db.purchase.findMany({
        where: { purchaseDate: { gte: p.from, lte: p.to } },
        include: { supplier: true, items: true },
        orderBy: { purchaseDate: "asc" },
      });
      return {
        ...base,
        columns: [
          { key: "purchaseDate", label: "Data", format: "date" },
          { key: "supplier", label: "Fornecedor" },
          { key: "items", label: "Itens", align: "right", format: "int" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
        ],
        rows: compras.map((c) => ({
          purchaseDate: c.purchaseDate,
          supplier: c.supplier?.name ?? "—",
          items: c.items.length,
          totalAmount: c.totalAmount,
        })),
        totals: { supplier: "TOTAL", totalAmount: add(...compras.map((c) => c.totalAmount)) },
      };
    }

    case "FIADO": {
      const contas = await db.creditAccount.findMany({
        where: { status: "EM_ABERTO" },
        orderBy: { createdAt: "asc" },
      });
      const rows = contas.map((c) => ({
        customerName: c.customerName,
        totalAmount: c.totalAmount,
        paidAmount: c.paidAmount,
        saldo: FinancialCalc.saldoFiado(c.totalAmount, c.paidAmount),
        status: CREDIT_STATUS_LABELS[c.status],
      }));
      return {
        ...base,
        columns: [
          { key: "customerName", label: "Cliente" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
          { key: "paidAmount", label: "Pago", align: "right", format: "money" },
          { key: "saldo", label: "Saldo", align: "right", format: "money" },
        ],
        rows,
        totals: { customerName: "TOTAL", saldo: add(...rows.map((r) => r.saldo)) },
      };
    }

    case "DESPESAS": {
      const despesas = await db.expense.findMany({
        where: { createdAt: { gte: p.from, lte: p.to } },
        include: { category: true },
        orderBy: { createdAt: "asc" },
      });
      return {
        ...base,
        columns: [
          { key: "description", label: "Descrição" },
          { key: "category", label: "Categoria" },
          { key: "type", label: "Tipo" },
          { key: "status", label: "Situação" },
          { key: "amount", label: "Valor", align: "right", format: "money" },
        ],
        rows: despesas.map((d) => ({
          description: d.description,
          category: d.category?.name ?? "—",
          type: EXPENSE_TYPE_LABELS[d.type],
          status: EXPENSE_STATUS_LABELS[d.status],
          amount: d.amount,
        })),
        totals: { description: "TOTAL", amount: add(...despesas.map((d) => d.amount)) },
      };
    }

    case "ESTOQUE": {
      const posicoes = await EstoqueService.getPositions(p.tenantId);
      return {
        ...base,
        columns: [
          { key: "name", label: "Produto" },
          { key: "quantity", label: "Quantidade", align: "right", format: "qty" },
          { key: "value", label: "Valor", align: "right", format: "money" },
        ],
        rows: posicoes.map((p2) => ({
          name: p2.name,
          quantity: p2.quantity,
          value: p2.value,
        })),
        totals: { name: "TOTAL", value: add(...posicoes.map((x) => x.value)) },
      };
    }
  }
}
