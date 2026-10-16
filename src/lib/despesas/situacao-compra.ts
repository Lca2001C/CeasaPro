import { startOfDayTz } from "@/lib/tz";

/**
 * Situação de pagamento de uma compra, lida da despesa que ela gerou
 * (`Expense.origem = COMPRA`).
 *
 * Compra antiga, de antes de toda compra virar despesa e sem backfill (ou
 * criada direto no banco por teste), não tem conta: aparece como "sem conta"
 * em vez de inventar que foi paga.
 */
export type SituacaoCompra = "PAGA" | "A_PAGAR" | "VENCIDA" | "SEM_CONTA";

export function situacaoDaCompra(
  conta: { status: "PENDENTE" | "PAGO"; dueDate: Date | null } | null | undefined,
  agora = new Date(),
): SituacaoCompra {
  if (!conta) return "SEM_CONTA";
  if (conta.status === "PAGO") return "PAGA";
  if (conta.dueDate && conta.dueDate < startOfDayTz(agora)) return "VENCIDA";
  return "A_PAGAR";
}

export const SITUACAO_COMPRA_LABELS: Record<SituacaoCompra, string> = {
  PAGA: "Paga",
  A_PAGAR: "A pagar",
  VENCIDA: "Vencida",
  SEM_CONTA: "Sem conta",
};
