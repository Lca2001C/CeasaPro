import type {
  SubscriptionStatus,
  TenantStatus,
  StatusSource,
} from "@prisma/client";

export type AccessDecision = "ok" | "warn" | "blocked";

/** Dias de uso grátis concedidos ao confirmar o e-mail no cadastro público. */
export const TRIAL_DAYS = 7;

/** A partir de quantos dias restantes o banner de fim de teste aparece. */
export const TRIAL_WARN_DAYS = 2;

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** Fim do teste grátis contado a partir da confirmação do e-mail. */
export function trialEndFrom(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * UM_DIA_MS);
}

/**
 * Dias inteiros que ainda faltam para o fim do teste, arredondando para cima:
 * faltando 1,2 dias o cliente lê "2 dias", não "1". Nunca negativo.
 */
export function trialDaysLeft(trialEndsAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / UM_DIA_MS));
}

/**
 * Avança exatamente um mês, em UTC, sem "vazar" para o mês seguinte.
 * `setMonth` nativo transformaria 31/08 em 01/10 (e 31/01 em 03/03), dando
 * dias de uso não pagos a cada renovação. Aqui o dia é limitado ao último dia do mês
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
 *
 * `TRIAL` é acesso normal: durante os 7 dias o uso é ilimitado. O aviso de fim de
 * teste NÃO passa por aqui — ver `billingNotice`, que precisa dos dias restantes
 * e de uma mensagem diferente da de mensalidade vencida.
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

/** Aviso a exibir no topo do sistema. `null` = nada a avisar. */
export type BillingNotice =
  | { kind: "trial_ending"; daysLeft: number }
  | { kind: "overdue" }
  | null;

/**
 * Aviso do topo do dashboard, separado de `accessDecision` de propósito.
 *
 * São duas situações diferentes que exigem mensagens diferentes: "seu teste
 * termina em 2 dias" (nunca pagou, precisa contratar) e "sua mensalidade venceu"
 * (é cliente, precisa regularizar). Espremer as duas no `"warn"` de
 * `accessDecision` daria a frase errada a metade dos casos — e `accessDecision`
 * não tem como expressar quantos dias faltam.
 */
export function billingNotice(args: {
  subStatus: SubscriptionStatus | null | undefined;
  trialEndsAt: Date | null | undefined;
  now?: Date;
}): BillingNotice {
  const now = args.now ?? new Date();

  if (args.subStatus === "TRIAL" && args.trialEndsAt) {
    const daysLeft = trialDaysLeft(args.trialEndsAt, now);
    // Só avisa na reta final: banner desde o 1º dia vira ruído e o cliente
    // aprende a ignorá-lo justamente antes de ele importar.
    if (daysLeft <= TRIAL_WARN_DAYS) return { kind: "trial_ending", daysLeft };
    return null;
  }

  if (args.subStatus === "VENCIDO") return { kind: "overdue" };
  return null;
}

/**
 * Recalcula o status da assinatura a partir das datas (usado pelo cron e no refresh).
 * Respeita override manual (statusSource = MANUAL).
 *
 * Antes do primeiro pagamento (`activatedAt` nulo) o único acesso possível é o
 * teste grátis, e ele é regido SÓ por `trialEndsAt`:
 *  - trial correndo  → TRIAL (uso ilimitado);
 *  - trial encerrado ou inexistente → SUSPENSO.
 *
 * Dois invariantes que precisam sobreviver a qualquer mudança aqui:
 *  1. `graceDays` NÃO se aplica a quem nunca pagou. A tolerância existe para
 *     cobrir a compensação bancária de um cliente, não para estender o teste.
 *  2. Trial vencido cai em SUSPENSO, nunca em VENCIDO. VENCIDO libera acesso com
 *     aviso — usá-lo aqui daria dias grátis além dos 7 combinados.
 *
 * `currentPeriodEnd` é deliberadamente ignorado enquanto não há `activatedAt`:
 * um valor generoso gravado na criação não pode virar acesso gratuito.
 */
export function computeStatus(
  sub: {
    status: SubscriptionStatus;
    statusSource: StatusSource;
    activatedAt: Date | null;
    trialEndsAt?: Date | null;
    currentPeriodEnd: Date;
    graceDays: number;
    cancelledAt: Date | null;
  },
  now: Date = new Date(),
): SubscriptionStatus {
  if (sub.cancelledAt) return "CANCELADO";
  if (sub.statusSource === "MANUAL") return sub.status; // override do super-admin

  // Nunca houve pagamento aprovado: só o teste grátis pode liberar acesso.
  if (!sub.activatedAt) {
    if (sub.trialEndsAt && now <= sub.trialEndsAt) return "TRIAL";
    return "SUSPENSO";
  }

  const graceEnd = new Date(sub.currentPeriodEnd);
  graceEnd.setDate(graceEnd.getDate() + sub.graceDays);

  if (now <= sub.currentPeriodEnd) return "ATIVO";
  if (now <= graceEnd) return "VENCIDO";
  return "SUSPENSO";
}
