import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { money, toDecimal } from "@/lib/money";
import { endOfDayTz, startOfDayTz } from "@/lib/tz";
import { isModuleEnabled } from "@/lib/plan/modules";

/**
 * "Tudo a pagar" — a visão que o cliente realmente tem na cabeça.
 *
 * O dono do box não pensa em módulos; ele pergunta "quanto tenho que pagar esta
 * semana?". Hoje a resposta está espalhada em três lugares que nunca se somam:
 * despesas (lançadas à mão), higienização (financeiro próprio do serviço) e o
 * frete das compras (saída de caixa que nem virava despesa). Este serviço junta.
 *
 * Cada origem carrega o seu `href`, porque a ação continua sendo no módulo dono
 * do dado — aqui é leitura, não um quarto lugar para pagar contas.
 */

export interface OrigemAPagar {
  chave: "despesas" | "despesas_vencidas" | "higienizacao";
  label: string;
  detalhe: string;
  count: number;
  total: Prisma.Decimal;
  href: string;
  urgente: boolean;
}

export interface ContasAPagar {
  origens: OrigemAPagar[];
  /** Soma de tudo que está em aberto, de todas as origens. */
  total: Prisma.Decimal;
  /** Recorte dos próximos 7 dias (inclui o que já venceu). */
  totalProximosSeteDias: Prisma.Decimal;
  countProximosSeteDias: number;
}

export const ContasPagarService = {
  /**
   * @param modules módulos do plano — higienização só entra se estiver contratada,
   *   senão o card levaria a uma tela bloqueada.
   */
  async get(
    tenantId: string,
    modules?: string[],
    agora = new Date(),
  ): Promise<ContasAPagar> {
    const db = getTenantPrisma(tenantId);
    const hoje = startOfDayTz(agora);
    const em7dias = endOfDayTz(new Date(hoje.getTime() + 7 * 864e5));
    const higienizacaoAtiva = isModuleEnabled(modules, "higienizacao");

    const [vencidas, aVencer, proximas, higienizacao] = await Promise.all([
      db.expense.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { status: "PENDENTE", dueDate: { lt: hoje } },
      }),
      db.expense.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: {
          status: "PENDENTE",
          OR: [{ dueDate: { gte: hoje } }, { dueDate: null }],
        },
      }),
      db.expense.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { status: "PENDENTE", dueDate: { not: null, lte: em7dias } },
      }),
      higienizacaoAtiva
        ? db.crateCleaning.findMany({
            where: { status: { not: "PAGO" } },
            select: { totalAmount: true, paidAmount: true },
          })
        : Promise.resolve([]),
    ]);

    const origens: OrigemAPagar[] = [];

    if (vencidas._count._all > 0) {
      origens.push({
        chave: "despesas_vencidas",
        label: "Contas vencidas",
        detalhe: `${vencidas._count._all} conta(s) atrasada(s)`,
        count: vencidas._count._all,
        total: money(toDecimal(vencidas._sum.amount ?? 0)),
        href: "/despesas?vencidas=1",
        urgente: true,
      });
    }

    if (aVencer._count._all > 0) {
      origens.push({
        chave: "despesas",
        label: "Contas a vencer",
        detalhe: `${aVencer._count._all} conta(s) em aberto`,
        count: aVencer._count._all,
        total: money(toDecimal(aVencer._sum.amount ?? 0)),
        href: "/despesas?status=PENDENTE",
        urgente: false,
      });
    }

    if (higienizacao.length > 0) {
      const totalHig = money(
        higienizacao.reduce(
          (a, c) => a.plus(c.totalAmount).minus(c.paidAmount),
          new Prisma.Decimal(0),
        ),
      );
      if (totalHig.greaterThan(0)) {
        origens.push({
          chave: "higienizacao",
          label: "Higienização de caixas",
          detalhe: `${higienizacao.length} envio(s) a pagar`,
          count: higienizacao.length,
          total: totalHig,
          href: "/higienizacao?status=DEVOLVIDO",
          urgente: false,
        });
      }
    }

    return {
      origens,
      total: money(origens.reduce((a, o) => a.plus(o.total), new Prisma.Decimal(0))),
      totalProximosSeteDias: money(toDecimal(proximas._sum.amount ?? 0)),
      countProximosSeteDias: proximas._count._all,
    };
  },
};
