import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { FinancialCalc } from "./financial-calc.service";
import { addDays } from "@/lib/dates";

export interface Aviso {
  tipo: "fiado_vencido" | "despesa_vencida" | "despesa_a_vencer" | "higienizacao_pendente";
  count: number;
  total: Prisma.Decimal;
  href: string;
  label: string;
}

/** Avisos operacionais para o topo do dashboard (o que precisa de atenção). */
export const AvisosService = {
  async get(tenantId: string): Promise<Aviso[]> {
    const db = getTenantPrisma(tenantId);
    const now = new Date();
    const em7dias = addDays(now, 7);

    const [fiadoVenc, despVenc, despAVencer, higPend] = await Promise.all([
      db.creditAccount.findMany({
        where: { status: "EM_ABERTO", dueDate: { lt: now } },
        select: { totalAmount: true, paidAmount: true },
      }),
      db.expense.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { status: "PENDENTE", dueDate: { lt: now } },
      }),
      db.expense.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { status: "PENDENTE", dueDate: { gte: now, lte: em7dias } },
      }),
      db.crateCleaning.findMany({
        where: { status: { not: "PAGO" } },
        select: { totalAmount: true, paidAmount: true },
      }),
    ]);

    const avisos: Aviso[] = [];

    if (fiadoVenc.length > 0) {
      const total = FinancialCalc.saldoFiado(
        fiadoVenc.reduce((a, c) => a.plus(c.totalAmount), new Prisma.Decimal(0)),
        fiadoVenc.reduce((a, c) => a.plus(c.paidAmount), new Prisma.Decimal(0)),
      );
      avisos.push({
        tipo: "fiado_vencido",
        count: fiadoVenc.length,
        total,
        href: "/fiado",
        label: `${fiadoVenc.length} cliente(s) com fiado vencido`,
      });
    }

    if (despVenc._count > 0) {
      avisos.push({
        tipo: "despesa_vencida",
        count: despVenc._count,
        total: despVenc._sum.amount ?? new Prisma.Decimal(0),
        href: "/despesas",
        label: `${despVenc._count} despesa(s) vencida(s)`,
      });
    }

    if (despAVencer._count > 0) {
      avisos.push({
        tipo: "despesa_a_vencer",
        count: despAVencer._count,
        total: despAVencer._sum.amount ?? new Prisma.Decimal(0),
        href: "/despesas",
        label: `${despAVencer._count} despesa(s) vencem em 7 dias`,
      });
    }

    if (higPend.length > 0) {
      const total = higPend.reduce(
        (a, c) => a.plus(c.totalAmount).minus(c.paidAmount),
        new Prisma.Decimal(0),
      );
      if (total.greaterThan(0)) {
        avisos.push({
          tipo: "higienizacao_pendente",
          count: higPend.length,
          total,
          href: "/higienizacao",
          label: `Higienização a pagar`,
        });
      }
    }

    return avisos;
  },
};
