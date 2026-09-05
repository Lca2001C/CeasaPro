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
  // O super-admin não passa pelo gate de cobrança nem pelo de plano, mesmo
  // tendo ambiente próprio: a assinatura desse ambiente existe só porque o
  // modelo de dados exige uma. Deixando `subStatus` nulo, `accessDecision`
  // devolve "ok" — quem administra a plataforma não pode ser expulso dela por
  // mensalidade.
  //
  // Para os módulos, o mecanismo mudou sem mudar a intenção. Antes o
  // super-admin ficava com `modules` INDEFINIDO, e `isModuleEnabled(undefined)`
  // liberava tudo. Só que `undefined` já significava outra coisa — "token
  // legado, de antes do claim existir" — e essa colisão obrigava o guard a ser
  // fail-open para todo mundo. Agora o super-admin recebe a lista completa
  // EXPLÍCITA: mesma liberação, dita em voz alta, e `undefined` deixa de ter
  // dois donos.
  let modules: string[];
  if (user.role === "SUPER_ADMIN") {
    modules = [...ALL_OPTIONAL_KEYS];
  } else if (sub) {
    const effective = computeStatus(sub);
    if (effective !== sub.status) {
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: effective },
      });
    }
    subStatus = effective;
    // `plan` é obrigatório por FK; o fallback cobre só leitura incompleta.
    modules = sub.plan ? planModules(sub.plan.features) : [...ALL_OPTIONAL_KEYS];
  } else {
    // Empresa sem assinatura não deveria existir — `provisionTenant` sempre
    // cria uma. Se aparecer, é anomalia de dados: nenhum módulo pago, e o log
    // torna o caso visível em vez de virar liberação silenciosa.
    modules = [];
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
