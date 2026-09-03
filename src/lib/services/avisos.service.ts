import { Prisma } from "@prisma/client";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { FinancialCalc } from "./financial-calc.service";
import { money } from "@/lib/money";
import { addDaysTz, endOfDayTz, startOfDayTz } from "@/lib/tz";

export interface Aviso {
  tipo: "fiado_vencido" | "despesa_vencida" | "despesa_a_vencer" | "higienizacao_pendente";
  count: number;
  total: Prisma.Decimal;
  href: string;
  label: string;
}

/**
 * Avisos operacionais para o topo do dashboard (o que precisa de atenção) e
 * para a notificação diária por push.
 *
 * Duas regras de produto governam o `href` de cada aviso:
 *
 *  - **Leva ao recorte, não à lista inteira.** Mandar para `/despesas` obrigava
 *    o dono do box a procurar, numa lista de meses, o que tinha vencido. Agora o
 *    link já chega filtrado.
 *  - **Uma conta só → leva à conta.** Quando o aviso é de um único item, o
 *    destino é a própria despesa: da notificação ao botão de pagar, sem escala.
 */
export const AvisosService = {
  async get(tenantId: string, agora = new Date()): Promise<Aviso[]> {
    const db = getTenantPrisma(tenantId);
    // O corte é o INÍCIO de hoje, não "agora": uma conta que vence hoje não
    // está vencida às 9h da manhã. Era o que acontecia com `dueDate < now`, e
    // divergia da lista de despesas, que já usava o começo do dia.
    const hoje = startOfDayTz(agora);
    const em7dias = endOfDayTz(addDaysTz(agora, 7));

    const [fiadoVenc, despVenc, despAVencer, higPend] = await Promise.all([
      db.creditAccount.findMany({
        where: { status: "EM_ABERTO", dueDate: { lt: hoje } },
        select: { totalAmount: true, paidAmount: true },
      }),
      // findMany em vez de aggregate: o id é o que permite linkar direto na
      // despesa quando existe apenas uma vencida.
      db.expense.findMany({
        where: { status: "PENDENTE", dueDate: { lt: hoje } },
        select: { id: true, amount: true },
        orderBy: { dueDate: "asc" },
      }),
      db.expense.findMany({
        where: { status: "PENDENTE", dueDate: { gte: hoje, lte: em7dias } },
        select: { id: true, amount: true },
        orderBy: { dueDate: "asc" },
      }),
      db.crateCleaning.findMany({
        where: { status: { not: "PAGO" } },
        select: { totalAmount: true, paidAmount: true },
      }),
    ]);

    const avisos: Aviso[] = [];
    const somar = (linhas: { amount: Prisma.Decimal }[]) =>
      money(linhas.reduce((a, l) => a.plus(l.amount), new Prisma.Decimal(0)));

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

    if (despVenc.length > 0) {
      avisos.push({
        tipo: "despesa_vencida",
        count: despVenc.length,
        total: somar(despVenc),
        href:
          despVenc.length === 1
            ? `/despesas/${despVenc[0]!.id}`
            : "/despesas?vencidas=1",
        label: `${despVenc.length} despesa(s) vencida(s)`,
      });
    }

    if (despAVencer.length > 0) {
      avisos.push({
        tipo: "despesa_a_vencer",
        count: despAVencer.length,
        total: somar(despAVencer),
        href:
          despAVencer.length === 1
            ? `/despesas/${despAVencer[0]!.id}`
            : "/despesas?status=PENDENTE&proximos=7",
        label: `${despAVencer.length} despesa(s) vencem em 7 dias`,
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
