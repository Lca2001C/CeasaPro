import type {
  SubscriptionStatus,
  TenantStatus,
  StatusSource,
} from "@prisma/client";

export type AccessDecision = "ok" | "warn" | "blocked";

/**
 * Avança exatamente um mês, em UTC, sem "vazar" para o mês seguinte.
 * `setMonth` nativo transformaria 31/08 em 01/10 (e 31/01 em 03/03), dando
 * dias grátis a cada renovação. Aqui o dia é limitado ao último dia do mês
 * de destino: 31/08 → 30/09, 31/01 → 28/02.
 * Usa UTC para o resultado não depender do fuso do servidor.
 */
export function addOneMonth(from: Date): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();
  const lastDayOfNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const next = new Date(from);
  next.setUTCFullYear(year, month + 1, Math.min(day, lastDayOfNextMonth));
  return next;
}

/**
 * Decisao de acesso a partir do status da empresa e da assinatura.
 * Fonte unica usada pelo proxy, pelo wrapper de acoes e pelas telas.
 *  - blocked: bloqueio total (redireciona para /conta/suspensa)
 *  - warn:    acesso liberado com aviso de vencimento
 *  - ok:      acesso normal
 */
export function accessDecision(
  tenantStatus: TenantStatus | null | undefined,
  subStatus: SubscriptionStatus | null | undefined,
): AccessDecision {
  if (tenantStatus === "SUSPENDED" || tenantStatus === "BLOCKED") return "blocked";
  if (
    subStatus === "SUSPENSO" ||
    subStatus === "BLOQUEADO" ||
    subStatus === "CANCELADO"
  ) {
    return "blocked";
  }
  if (subStatus === "VENCIDO") return "warn";
  return "ok";
}

/**
 * Recalcula o status da assinatura a partir das datas (usado pelo cron e no refresh).
 * Respeita override manual (statusSource = MANUAL).
 */
export function computeStatus(
  sub: {
    status: SubscriptionStatus;
    statusSource: StatusSource;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date;
    graceDays: number;
    cancelledAt: Date | null;
  },
  now: Date = new Date(),
): SubscriptionStatus {
  if (sub.cancelledAt) return "CANCELADO";
  if (sub.statusSource === "MANUAL") return sub.status; // override do super-admin

  if (sub.trialEndsAt && now <= sub.trialEndsAt) return "TRIAL";

  const graceEnd = new Date(sub.currentPeriodEnd);
  graceEnd.setDate(graceEnd.getDate() + sub.graceDays);

  if (now <= sub.currentPeriodEnd) return "ATIVO";
  if (now <= graceEnd) return "VENCIDO";
  return "SUSPENSO";
}
