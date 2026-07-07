import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { EstoqueService } from "@/lib/services/estoque.service";
import { CaixasService } from "@/lib/services/caixas.service";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { add, sub, toDecimal, money } from "@/lib/money";
import {
  PAYMENT_METHOD_LABELS,
  EXPENSE_TYPE_LABELS,
  EXPENSE_STATUS_LABELS,
  CREDIT_STATUS_LABELS,
  CRATE_MOVEMENT_LABELS,
  CRATE_CLEANING_STATUS_LABELS,
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

    // ───────────────────────── Avançados (Fase 2) ─────────────────────────

    case "LUCRO_PRODUTO": {
      // Receita, custo (snapshot na venda) e lucro por produto no período.
      const rows = await prisma.$queryRaw<
        { name: string; qtd: Prisma.Decimal; receita: Prisma.Decimal; custo: Prisma.Decimal }[]
      >`
        SELECT pr.name AS name,
               COALESCE(SUM(si.quantity), 0) AS qtd,
               COALESCE(SUM(si."lineTotal"), 0) AS receita,
               COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0) AS custo
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        JOIN products pr ON pr.id = si."productId"
        WHERE si."tenantId" = ${p.tenantId} AND s."deletedAt" IS NULL
          AND s."saleDate" >= ${p.from} AND s."saleDate" <= ${p.to}
        GROUP BY pr.name
        ORDER BY (COALESCE(SUM(si."lineTotal"), 0) - COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0)) DESC
      `;
      const mapped = rows.map((r) => ({
        name: r.name,
        qtd: toDecimal(r.qtd),
        receita: money(toDecimal(r.receita)),
        custo: money(toDecimal(r.custo)),
        lucro: money(sub(r.receita, r.custo)),
      }));
      return {
        ...base,
        columns: [
          { key: "name", label: "Produto" },
          { key: "qtd", label: "Qtd. vendida", align: "right", format: "qty" },
          { key: "receita", label: "Receita", align: "right", format: "money" },
          { key: "custo", label: "Custo", align: "right", format: "money" },
          { key: "lucro", label: "Lucro", align: "right", format: "money" },
        ],
        rows: mapped,
        totals: {
          name: "TOTAL",
          receita: add(...mapped.map((m) => m.receita)),
          custo: add(...mapped.map((m) => m.custo)),
          lucro: add(...mapped.map((m) => m.lucro)),
        },
      };
    }

    case "MAIS_VENDIDOS": {
      const rows = await prisma.$queryRaw<
        { name: string; qtd: Prisma.Decimal; receita: Prisma.Decimal }[]
      >`
        SELECT pr.name AS name,
               COALESCE(SUM(si.quantity), 0) AS qtd,
               COALESCE(SUM(si."lineTotal"), 0) AS receita
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        JOIN products pr ON pr.id = si."productId"
        WHERE si."tenantId" = ${p.tenantId} AND s."deletedAt" IS NULL
          AND s."saleDate" >= ${p.from} AND s."saleDate" <= ${p.to}
        GROUP BY pr.name
        ORDER BY COALESCE(SUM(si.quantity), 0) DESC
        LIMIT 50
      `;
      return {
        ...base,
        columns: [
          { key: "name", label: "Produto" },
          { key: "qtd", label: "Qtd. vendida", align: "right", format: "qty" },
          { key: "receita", label: "Receita", align: "right", format: "money" },
        ],
        rows: rows.map((r) => ({
          name: r.name,
          qtd: toDecimal(r.qtd),
          receita: money(toDecimal(r.receita)),
        })),
        totals: { name: "TOTAL", receita: add(...rows.map((r) => r.receita)) },
      };
    }

    case "INADIMPLENTES": {
      // Fiado em aberto com vencimento passado (ou sem vencimento e antigo).
      const contas = await db.creditAccount.findMany({
        where: { status: "EM_ABERTO", dueDate: { lt: new Date() } },
        orderBy: { dueDate: "asc" },
      });
      const rows = contas.map((c) => ({
        customerName: c.customerName,
        dueDate: c.dueDate,
        totalAmount: c.totalAmount,
        paidAmount: c.paidAmount,
        saldo: FinancialCalc.saldoFiado(c.totalAmount, c.paidAmount),
      }));
      return {
        ...base,
        columns: [
          { key: "customerName", label: "Cliente" },
          { key: "dueDate", label: "Vencimento", format: "date" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
          { key: "paidAmount", label: "Pago", align: "right", format: "money" },
          { key: "saldo", label: "Em atraso", align: "right", format: "money" },
        ],
        rows,
        totals: { customerName: "TOTAL", saldo: add(...rows.map((r) => r.saldo)) },
      };
    }

    case "FORNECEDORES": {
      const compras = await db.purchase.findMany({
        where: { purchaseDate: { gte: p.from, lte: p.to } },
        include: { supplier: true },
      });
      const porFornecedor = new Map<string, { name: string; compras: number; total: Prisma.Decimal }>();
      for (const c of compras) {
        const key = c.supplier?.name ?? "Sem fornecedor";
        const cur = porFornecedor.get(key) ?? { name: key, compras: 0, total: toDecimal(0) };
        cur.compras += 1;
        cur.total = add(cur.total, c.totalAmount);
        porFornecedor.set(key, cur);
      }
      const rows = [...porFornecedor.values()].sort((a, b) =>
        b.total.comparedTo(a.total),
      );
      return {
        ...base,
        columns: [
          { key: "name", label: "Fornecedor" },
          { key: "compras", label: "Compras", align: "right", format: "int" },
          { key: "total", label: "Total comprado", align: "right", format: "money" },
        ],
        rows,
        totals: { name: "TOTAL", total: add(...rows.map((r) => r.total)) },
      };
    }

    case "FLUXO_CAIXA": {
      // Entradas = vendas à vista + recebimentos de fiado + venda de embalagens.
      // Saídas = compras + despesas pagas + pagamentos de higienização.
      const dayExpr = (col: string) => Prisma.raw(`DATE_TRUNC('day', ${col})::date`);
      const [vendasVista, recebFiado, vendEmb, compras, despesasPagas, pagHig] =
        await Promise.all([
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"saleDate"')} AS d, SUM("totalAmount") AS total FROM sales
            WHERE "tenantId" = ${p.tenantId} AND "deletedAt" IS NULL AND "paymentMethod" <> 'FIADO'
              AND "saleDate" >= ${p.from} AND "saleDate" <= ${p.to} GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"paidAt"')} AS d, SUM(amount) AS total FROM credit_payments
            WHERE "tenantId" = ${p.tenantId}
              AND "paidAt" >= ${p.from} AND "paidAt" <= ${p.to} GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"saleDate"')} AS d, SUM("totalAmount") AS total FROM packaging_sales
            WHERE "tenantId" = ${p.tenantId} AND "deletedAt" IS NULL
              AND "saleDate" >= ${p.from} AND "saleDate" <= ${p.to} GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"purchaseDate"')} AS d, SUM("totalAmount") AS total FROM purchases
            WHERE "tenantId" = ${p.tenantId} AND "deletedAt" IS NULL
              AND "purchaseDate" >= ${p.from} AND "purchaseDate" <= ${p.to} GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"paidDate"')} AS d, SUM(amount) AS total FROM expenses
            WHERE "tenantId" = ${p.tenantId} AND "deletedAt" IS NULL AND "paidDate" IS NOT NULL
              AND "paidDate" >= ${p.from} AND "paidDate" <= ${p.to} GROUP BY 1`,
          prisma.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
            SELECT ${dayExpr('"paidDate"')} AS d, SUM("paidAmount") AS total FROM crate_cleanings
            WHERE "tenantId" = ${p.tenantId} AND "deletedAt" IS NULL AND "paidDate" IS NOT NULL
              AND "paidDate" >= ${p.from} AND "paidDate" <= ${p.to} GROUP BY 1`,
        ]);

      const days = new Map<string, { entradas: Prisma.Decimal; saidas: Prisma.Decimal }>();
      const bump = (list: { d: Date; total: Prisma.Decimal }[], kind: "entradas" | "saidas") => {
        for (const r of list) {
          const key = new Date(r.d).toISOString().slice(0, 10);
          const cur = days.get(key) ?? { entradas: toDecimal(0), saidas: toDecimal(0) };
          cur[kind] = add(cur[kind], r.total ?? 0);
          days.set(key, cur);
        }
      };
      bump(vendasVista, "entradas");
      bump(recebFiado, "entradas");
      bump(vendEmb, "entradas");
      bump(compras, "saidas");
      bump(despesasPagas, "saidas");
      bump(pagHig, "saidas");

      const rows = [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => ({
          date: new Date(key + "T12:00:00"),
          entradas: money(v.entradas),
          saidas: money(v.saidas),
          saldo: money(sub(v.entradas, v.saidas)),
        }));
      return {
        ...base,
        columns: [
          { key: "date", label: "Dia", format: "date" },
          { key: "entradas", label: "Entradas", align: "right", format: "money" },
          { key: "saidas", label: "Saídas", align: "right", format: "money" },
          { key: "saldo", label: "Saldo do dia", align: "right", format: "money" },
        ],
        rows,
        totals: {
          date: "TOTAL",
          entradas: add(...rows.map((r) => r.entradas)),
          saidas: add(...rows.map((r) => r.saidas)),
          saldo: add(...rows.map((r) => r.saldo)),
        },
      };
    }

    case "CAIXAS_PLASTICAS": {
      const [movimentos, saldo] = await Promise.all([
        db.plasticCrateMovement.findMany({
          where: { movementDate: { gte: p.from, lte: p.to } },
          orderBy: { movementDate: "asc" },
        }),
        CaixasService.getSaldo(p.tenantId),
      ]);
      const rows = movimentos.map((m) => ({
        movementDate: m.movementDate,
        type: CRATE_MOVEMENT_LABELS[m.type],
        quantity: m.quantity,
        brokenQty: m.brokenQty,
        who: m.customerName ?? m.supplierName ?? "—",
      }));
      return {
        ...base,
        columns: [
          { key: "movementDate", label: "Data", format: "date" },
          { key: "type", label: "Tipo" },
          { key: "who", label: "Cliente/Origem" },
          { key: "quantity", label: "Qtd.", align: "right", format: "int" },
          { key: "brokenQty", label: "Quebradas", align: "right", format: "int" },
        ],
        rows,
        totals: {
          type: `Saldo: ${saldo.vazias} vazias · ${saldo.comClientes} c/ clientes · ${saldo.perdidas} perdidas`,
        },
      };
    }

    case "HIGIENIZACAO": {
      const registros = await db.crateCleaning.findMany({
        where: { sentDate: { gte: p.from, lte: p.to } },
        orderBy: { sentDate: "asc" },
      });
      const rows = registros.map((c) => ({
        sentDate: c.sentDate,
        cleanerName: c.cleanerName,
        status: CRATE_CLEANING_STATUS_LABELS[c.status],
        sentQty: c.sentQty,
        returnedQty: c.returnedQty,
        totalAmount: c.totalAmount,
        paidAmount: c.paidAmount,
        aPagar: money(sub(c.totalAmount, c.paidAmount)),
      }));
      return {
        ...base,
        columns: [
          { key: "sentDate", label: "Envio", format: "date" },
          { key: "cleanerName", label: "Higienizador" },
          { key: "status", label: "Situação" },
          { key: "sentQty", label: "Enviadas", align: "right", format: "int" },
          { key: "returnedQty", label: "Devolvidas", align: "right", format: "int" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
          { key: "paidAmount", label: "Pago", align: "right", format: "money" },
          { key: "aPagar", label: "A pagar", align: "right", format: "money" },
        ],
        rows,
        totals: {
          cleanerName: "TOTAL",
          totalAmount: add(...rows.map((r) => r.totalAmount)),
          paidAmount: add(...rows.map((r) => r.paidAmount)),
          aPagar: add(...rows.map((r) => r.aPagar)),
        },
      };
    }

    case "EMBALAGENS": {
      const vendas = await db.packagingSale.findMany({
        where: { saleDate: { gte: p.from, lte: p.to } },
        include: { type: true },
        orderBy: { saleDate: "asc" },
      });
      const rows = vendas.map((v) => ({
        saleDate: v.saleDate,
        type: v.type.name,
        customerName: v.customerName ?? "—",
        quantity: v.quantity,
        unitPrice: v.unitPrice,
        totalAmount: v.totalAmount,
      }));
      return {
        ...base,
        columns: [
          { key: "saleDate", label: "Data", format: "date" },
          { key: "type", label: "Tipo" },
          { key: "customerName", label: "Cliente" },
          { key: "quantity", label: "Qtd.", align: "right", format: "int" },
          { key: "unitPrice", label: "Unitário", align: "right", format: "money" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
        ],
        rows,
        totals: {
          type: "TOTAL",
          quantity: rows.reduce((a, r) => a + r.quantity, 0),
          totalAmount: add(...rows.map((r) => r.totalAmount)),
        },
      };
    }
  }
}
