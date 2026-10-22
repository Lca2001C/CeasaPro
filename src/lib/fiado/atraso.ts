import { addDaysTz, startOfDayTz } from "@/lib/tz";

/**
 * Quando um fiado EM ABERTO está atrasado — a mesma régua no relatório de
 * cobrança, no sino, no push e na tela do fiado.
 *
 * Antes só o relatório contava a conta SEM vencimento: o sino e o push olhavam
 * só `dueDate < hoje`, então o fiado mais comum do balcão (o "paga quando
 * puder", sem data) nunca era cobrado pelo aviso, e as telas não fechavam com o
 * relatório.
 *
 * Com vencimento: atrasado a partir do dia seguinte ao vencimento. Sem
 * vencimento: atrasado depois de {@link DIAS_PARA_COBRAR_SEM_VENCIMENTO} dias
 * aberto. Sem uma régua, "antigo" não é verificável.
 */
export const DIAS_PARA_COBRAR_SEM_VENCIMENTO = 30;

/** Abertas antes disto, sem vencimento, já estão atrasadas. `hoje` = início do dia. */
function limiteSemVencimento(hoje: Date): Date {
  return addDaysTz(hoje, -DIAS_PARA_COBRAR_SEM_VENCIMENTO);
}

export function fiadoAtrasado(
  conta: { dueDate: Date | null; createdAt: Date },
  agora: Date,
): boolean {
  const hoje = startOfDayTz(agora);
  return conta.dueDate !== null
    ? conta.dueDate < hoje
    : conta.createdAt < limiteSemVencimento(hoje);
}

/** O mesmo critério como filtro do Prisma (some ao `status: "EM_ABERTO"`). */
export function whereFiadoAtrasado(agora: Date) {
  const hoje = startOfDayTz(agora);
  return {
    OR: [
      { dueDate: { lt: hoje } },
      { dueDate: null, createdAt: { lt: limiteSemVencimento(hoje) } },
    ],
  };
}
