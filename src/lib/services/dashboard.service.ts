import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { toDecimal, money } from "@/lib/money";
import { FinancialCalc } from "./financial-calc.service";
import { EstoqueService } from "./estoque.service";
import { startOfDay, startOfMonth, addDays } from "@/lib/dates";

export interface DashboardProductRow {
  productId: string;
  name: string;
  quantity: Prisma.Decimal;
  total: Prisma.Decimal;
  profit: Prisma.Decimal;
}

export interface DashboardIdleProduct {
  productId: string;
  name: string;
  quantity: Prisma.Decimal;
  lastMovementAt: Date | null;
}

export interface DashboardSummary {
  hojeVendi: Prisma.Decimal;
  semanaVendi: Prisma.Decimal;
  mesVendi: Prisma.Decimal;
  totalCompradoMes: Prisma.Decimal;
  aReceber: Prisma.Decimal;
  contasPagar: Prisma.Decimal;
  estoqueValor: Prisma.Decimal;
  lucroBrutoMes: Prisma.Decimal;
  lucroMes: Prisma.Decimal;
  margemLiquidaMes: Prisma.Decimal;
  despesasFixasMes: Prisma.Decimal;
  despesasVariaveisMes: Prisma.Decimal;
  topVendidos: DashboardProductRow[];
  topLucrativos: DashboardProductRow[];
  produtosComPrejuizo: DashboardProductRow[];
  estoqueParado: DashboardIdleProduct[];
  chart: { date: string; total: number }[];
}

export const DashboardService = {
  async getSummary(tenantId: string): Promise<DashboardSummary> {
    const db = getTenantPrisma(tenantId);
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfDay(addDays(now, -6));
    const monthStart = startOfMonth(now);
    const chartStart = startOfDay(addDays(now, -29));
    const idleCutoff = startOfDay(addDays(now, -30));

    const [
      hoje,
      semana,
      cred,
      contasPagar,
      comprasMes,
      vendasMes,
      cmvRows,
      despRows,
      chartRows,
      estoqueValor,
      topVendidosRows,
      topLucrativosRows,
      prejuizoRows,
      estoqueParadoRows,
    ] = await Promise.all([
      db.sale.aggregate({
        _sum: { totalAmount: true },
        where: { saleDate: { gte: todayStart } },
      }),
      db.sale.aggregate({
        _sum: { totalAmount: true },
        where: { saleDate: { gte: weekStart } },
      }),
      db.creditAccount.aggregate({
        _sum: { totalAmount: true, paidAmount: true },
        where: { status: "EM_ABERTO" },
      }),
      db.expense.aggregate({
        _sum: { amount: true },
        where: { status: "PENDENTE" },
      }),
      db.purchase.aggregate({
        _sum: { totalAmount: true },
        where: { purchaseDate: { gte: monthStart } },
      }),
      db.sale.aggregate({
        _sum: { totalAmount: true },
        where: { saleDate: { gte: monthStart } },
      }),
      prisma.$queryRaw<{ cmv: Prisma.Decimal | string }[]>`
        SELECT COALESCE(SUM(si.quantity * si."unitCostAtSale"), 0) AS cmv
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        WHERE si."tenantId" = ${tenantId} AND s."saleDate" >= ${monthStart} AND s."deletedAt" IS NULL
      `,
      prisma.$queryRaw<{ type: string; total: Prisma.Decimal | string }[]>`
        SELECT type::text AS type, COALESCE(SUM(amount), 0) AS total
        FROM expenses
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
          AND COALESCE("dueDate", "createdAt") >= ${monthStart}
        GROUP BY type
      `,
      prisma.$queryRaw<{ d: Date; total: Prisma.Decimal | string }[]>`
        SELECT DATE_TRUNC('day', "saleDate") AS d, SUM("totalAmount") AS total
        FROM sales
        WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "saleDate" >= ${chartStart}
        GROUP BY d ORDER BY d ASC
      `,
      EstoqueService.getTotalValue(tenantId),
      prisma.$queryRaw<ProductMetricRow[]>`
        SELECT p.id AS "productId",
               p.name AS name,
               COALESCE(SUM(si.quantity), 0) AS quantity,
               COALESCE(SUM(si."lineTotal"), 0) AS total,
               COALESCE(SUM(si."lineTotal" - (si.quantity * si."unitCostAtSale")), 0) AS profit
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        JOIN products p ON p.id = si."productId"
        WHERE si."tenantId" = ${tenantId} AND s."deletedAt" IS NULL AND s."saleDate" >= ${monthStart}
        GROUP BY p.id, p.name
        ORDER BY quantity DESC, total DESC
        LIMIT 5
      `,
      prisma.$queryRaw<ProductMetricRow[]>`
        SELECT p.id AS "productId",
               p.name AS name,
               COALESCE(SUM(si.quantity), 0) AS quantity,
               COALESCE(SUM(si."lineTotal"), 0) AS total,
               COALESCE(SUM(si."lineTotal" - (si.quantity * si."unitCostAtSale")), 0) AS profit
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        JOIN products p ON p.id = si."productId"
        WHERE si."tenantId" = ${tenantId} AND s."deletedAt" IS NULL AND s."saleDate" >= ${monthStart}
        GROUP BY p.id, p.name
        ORDER BY profit DESC, total DESC
        LIMIT 5
      `,
      prisma.$queryRaw<ProductMetricRow[]>`
        SELECT p.id AS "productId",
               p.name AS name,
               COALESCE(SUM(si.quantity), 0) AS quantity,
               COALESCE(SUM(si."lineTotal"), 0) AS total,
               COALESCE(SUM(si."lineTotal" - (si.quantity * si."unitCostAtSale")), 0) AS profit
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        JOIN products p ON p.id = si."productId"
        WHERE si."tenantId" = ${tenantId} AND s."deletedAt" IS NULL AND s."saleDate" >= ${monthStart}
        GROUP BY p.id, p.name
        HAVING COALESCE(SUM(si."lineTotal" - (si.quantity * si."unitCostAtSale")), 0) < 0
        ORDER BY profit ASC
        LIMIT 5
      `,
      prisma.$queryRaw<IdleProductRow[]>`
        WITH saldo AS (
          SELECT "productId",
                 COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END), 0) AS quantity,
                 MAX("movedAt") AS "lastMovementAt"
          FROM stock_movements
          WHERE "tenantId" = ${tenantId}
          GROUP BY "productId"
        )
        SELECT p.id AS "productId",
               p.name AS name,
               saldo.quantity AS quantity,
               saldo."lastMovementAt" AS "lastMovementAt"
        FROM saldo
        JOIN products p ON p.id = saldo."productId"
        WHERE p."tenantId" = ${tenantId}
          AND p."deletedAt" IS NULL
          AND saldo.quantity > 0
          AND NOT EXISTS (
            SELECT 1
            FROM sale_items si
            JOIN sales s ON s.id = si."saleId"
            WHERE si."tenantId" = ${tenantId}
              AND si."productId" = p.id
              AND s."deletedAt" IS NULL
              AND s."saleDate" >= ${idleCutoff}
          )
        ORDER BY saldo."lastMovementAt" ASC NULLS FIRST, p.name ASC
        LIMIT 5
      `,
    ]);

    const vendasMesTotal = toDecimal(vendasMes._sum.totalAmount ?? 0);
    const cmvMes = toDecimal((cmvRows[0]?.cmv ?? 0) as Prisma.Decimal.Value);
    const despesasFixasMes = sumExpenseByType(despRows, "FIXA");
    const despesasVariaveisMes = sumExpenseByType(despRows, "VARIAVEL");
    const despesasMes = money(despesasFixasMes.plus(despesasVariaveisMes));
    const lucroBrutoMes = FinancialCalc.lucroBruto(vendasMesTotal, cmvMes);
    const lucroMes = FinancialCalc.lucroLiquido(lucroBrutoMes, despesasMes);

    const aReceber = FinancialCalc.saldoFiado(
      cred._sum.totalAmount ?? 0,
      cred._sum.paidAmount ?? 0,
    );

    const byDay = new Map<string, number>();
    for (const r of chartRows) {
      const key = new Date(r.d).toISOString().slice(0, 10);
      byDay.set(key, toDecimal(r.total as Prisma.Decimal.Value).toNumber());
    }
    const chart: { date: string; total: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = addDays(now, -i).toISOString().slice(0, 10);
      chart.push({ date: day, total: byDay.get(day) ?? 0 });
    }

    return {
      hojeVendi: money(toDecimal(hoje._sum.totalAmount ?? 0)),
      semanaVendi: money(toDecimal(semana._sum.totalAmount ?? 0)),
      mesVendi: money(vendasMesTotal),
      totalCompradoMes: money(toDecimal(comprasMes._sum.totalAmount ?? 0)),
      aReceber,
      contasPagar: money(toDecimal(contasPagar._sum.amount ?? 0)),
      estoqueValor,
      lucroBrutoMes,
      lucroMes,
      margemLiquidaMes: FinancialCalc.margemLiquida(lucroMes, vendasMesTotal),
      despesasFixasMes,
      despesasVariaveisMes,
      topVendidos: mapProductMetric(topVendidosRows),
      topLucrativos: mapProductMetric(topLucrativosRows),
      produtosComPrejuizo: mapProductMetric(prejuizoRows),
      estoqueParado: estoqueParadoRows.map((r) => ({
        productId: r.productId,
        name: r.name,
        quantity: toDecimal(r.quantity as Prisma.Decimal.Value),
        lastMovementAt: r.lastMovementAt,
      })),
      chart,
    };
  },
};

interface ProductMetricRow {
  productId: string;
  name: string;
  quantity: Prisma.Decimal | string;
  total: Prisma.Decimal | string;
  profit: Prisma.Decimal | string;
}

interface IdleProductRow {
  productId: string;
  name: string;
  quantity: Prisma.Decimal | string;
  lastMovementAt: Date | null;
}

function mapProductMetric(rows: ProductMetricRow[]): DashboardProductRow[] {
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    quantity: toDecimal(r.quantity as Prisma.Decimal.Value),
    total: money(toDecimal(r.total as Prisma.Decimal.Value)),
    profit: money(toDecimal(r.profit as Prisma.Decimal.Value)),
  }));
}

function sumExpenseByType(
  rows: { type: string; total: Prisma.Decimal | string }[],
  type: "FIXA" | "VARIAVEL",
) {
  return money(
    toDecimal((rows.find((r) => r.type === type)?.total ?? 0) as Prisma.Decimal.Value),
  );
}
