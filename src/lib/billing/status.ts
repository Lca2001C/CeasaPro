import type {
  SubscriptionStatus,
  TenantStatus,
  StatusSource,
} from "@prisma/client";

export type AccessDecision = "ok" | "warn" | "blocked";

/**
 * Decisão de acesso a partir do status da empresa e da assinatura.
 * Fonte única usada pelo middleware (Edge), pelo wrapper de ações e pelas telas.
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
