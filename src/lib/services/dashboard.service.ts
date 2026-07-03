import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { toDecimal, money } from "@/lib/money";
import { FinancialCalc } from "./financial-calc.service";
import { startOfDay, startOfMonth, addDays } from "@/lib/dates";

export interface DashboardSummary {
  hojeVendi: Prisma.Decimal;
  aReceber: Prisma.Decimal;
  estoqueValor: Prisma.Decimal;
  lucroMes: Prisma.Decimal;
  chart: { date: string; total: number }[];
}

export const DashboardService = {
  async getSummary(tenantId: string): Promise<DashboardSummary> {
    const db = getTenantPrisma(tenantId);
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = startOfMonth(now);
    const chartStart = startOfDay(addDays(now, -29));

    const [hoje, cred, vendasMes, cmvRows, despRows, chartRows, estoqueValor] =
      await Promise.all([
        db.sale.aggregate({
          _sum: { totalAmount: true },
          where: { saleDate: { gte: todayStart } },
        }),
        db.creditAccount.aggregate({
          _sum: { totalAmount: true, paidAmount: true },
          where: { status: "EM_ABERTO" },
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
        prisma.$queryRaw<{ total: Prisma.Decimal | string }[]>`
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM expenses
          WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
            AND COALESCE("dueDate", "createdAt") >= ${monthStart}
        `,
        prisma.$queryRaw<{ d: Date; total: Prisma.Decimal | string }[]>`
          SELECT DATE_TRUNC('day', "saleDate") AS d, SUM("totalAmount") AS total
          FROM sales
          WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "saleDate" >= ${chartStart}
          GROUP BY d ORDER BY d ASC
        `,
        EstoqueTotalValue(tenantId),
      ]);

    const vendasMesTotal = toDecimal(vendasMes._sum.totalAmount ?? 0);
    const cmvMes = toDecimal((cmvRows[0]?.cmv ?? 0) as Prisma.Decimal.Value);
    const despMes = toDecimal((despRows[0]?.total ?? 0) as Prisma.Decimal.Value);
    const lucroBruto = FinancialCalc.lucroBruto(vendasMesTotal, cmvMes);
    const lucroMes = FinancialCalc.lucroLiquido(lucroBruto, despMes);

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
      aReceber,
      estoqueValor,
      lucroMes,
      chart,
    };
  },
};

// Evita import circular chamando o EstoqueService por função local.
async function EstoqueTotalValue(tenantId: string): Promise<Prisma.Decimal> {
  const rows = await prisma.$queryRaw<{ value: Prisma.Decimal | string }[]>`
    SELECT COALESCE(SUM(CASE WHEN type IN ('ENTRADA','AJUSTE') THEN quantity ELSE -quantity END * COALESCE("unitCost", 0)), 0) AS value
    FROM stock_movements
    WHERE "tenantId" = ${tenantId}
  `;
  return money(toDecimal((rows[0]?.value ?? 0) as Prisma.Decimal.Value));
}
