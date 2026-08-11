import "server-only";
import { prisma } from "@/lib/db/prisma";
import { computeStatus } from "@/lib/billing/status";
import { planModules, ALL_OPTIONAL_KEYS } from "@/lib/plan/modules";
import type { AccessPayload } from "./jwt";

/**
 * Monta o payload do access token a partir do usuário, recalculando e
 * persistindo o status da assinatura (ATIVO/VENCIDO/SUSPENSO...) a partir das datas.
 * Usado no login e no refresh — assim o bloqueio por vencimento propaga em ≤ TTL do token.
 */
export async function buildAccessPayload(userId: string): Promise<AccessPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { tenant: { include: { subscription: { include: { plan: true } } } } },
  });

  if (!user || !user.active || user.deletedAt) return null;

  let subStatus: AccessPayload["subStatus"] = null;
  const tenantStatus = user.tenant?.status ?? null;

  const sub = user.tenant?.subscription;
  // Super-admin não tem tenant/plano → mantém undefined (não gateia nada).
  let modules: string[] | undefined;
  if (sub) {
    const effective = computeStatus(sub);
    if (effective !== sub.status) {
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: effective },
      });
    }
    subStatus = effective;
    modules = sub.plan ? planModules(sub.plan.features) : [...ALL_OPTIONAL_KEYS];
  }

  return {
    sub: user.id,
    role: user.role,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    mustChangePassword: user.mustChangePassword,
    tenantStatus,
    subStatus,
    modules,
  };
}
