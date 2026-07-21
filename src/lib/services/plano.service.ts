import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { planModules, OPTIONAL_MODULES, ALL_OPTIONAL_KEYS } from "@/lib/plan/modules";
import type { OptionalModuleKey } from "@/lib/plan/modules";
import { audit } from "@/lib/audit";
import { NotFoundError, BusinessRuleError } from "@/lib/http/app-error";
import type { TenantCtx } from "@/lib/http/with-action";

export interface PlanoView {
  planName: string;
  priceMonthly: unknown; // Prisma.Decimal (formatado na borda)
  status: string;
  currentPeriodEnd: Date | null;
  maxUsers: number | null;
  modules: { key: OptionalModuleKey; label: string; description: string; enabled: boolean }[];
  usage: { produtos: number; usuarios: number };
}

/** Plano ofertado ao cliente para troca (dados já serializáveis para o cliente). */
export interface AvailablePlan {
  id: string;
  name: string;
  priceMonthly: number;
  maxUsers: number | null;
  /** Rótulos dos módulos opcionais incluídos neste plano. */
  modules: string[];
  isCurrent: boolean;
}

export const PlanoService = {
  async getPlanoView(tenantId: string): Promise<PlanoView | null> {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (!sub) return null;

    const db = getTenantPrisma(tenantId);
    const [produtos, usuarios] = await Promise.all([
      db.product.count(),
      prisma.user.count({ where: { tenantId, deletedAt: null } }),
    ]);

    const enabled = new Set(planModules(sub.plan?.features));
    const modules = ALL_OPTIONAL_KEYS.map((key) => ({
      key,
      label: OPTIONAL_MODULES[key].label,
      description: OPTIONAL_MODULES[key].description,
      enabled: enabled.has(key),
    }));

    return {
      planName: sub.plan?.name ?? "—",
      priceMonthly: sub.monthlyAmount,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      maxUsers: sub.plan?.maxUsers ?? null,
      modules,
      usage: { produtos, usuarios },
    };
  },

  /** Planos ativos que o cliente pode contratar (o atual vem marcado com isCurrent). */
  async listAvailablePlans(tenantId: string): Promise<AvailablePlan[]> {
    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    const currentPlanId = sub?.planId ?? null;

    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { priceMonthly: "asc" },
    });

    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceMonthly: Number(p.priceMonthly),
      maxUsers: p.maxUsers,
      modules: planModules(p.features).map((k) => OPTIONAL_MODULES[k].label),
      isCurrent: p.id === currentPlanId,
    }));
  },

  /**
   * Troca a assinatura da empresa para outro plano ATIVO.
   * Regras (autoritativas no servidor):
   *  - só planos existentes e ativos; nunca o plano atual;
   *  - o valor mensal vem SEMPRE do plano (nunca do cliente);
   *  - o novo plano precisa comportar o número atual de usuários (limite maxUsers);
   *  - a troca vale imediatamente (módulos mudam no próximo refresh do token); o novo
   *    valor é cobrado na próxima renovação — não há proporcional nesta versão.
   * Não altera status/vencimento/origem (respeita eventual bloqueio manual do super-admin).
   */
  async changePlan(planId: string, ctx: TenantCtx) {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: ctx.tenantId },
      include: { plan: true },
    });
    if (!sub) throw new NotFoundError("Assinatura não encontrada");

    const target = await prisma.plan.findUnique({ where: { id: planId } });
    if (!target || !target.active) throw new NotFoundError("Plano indisponível");
    if (target.id === sub.planId) {
      throw new BusinessRuleError("Este já é o seu plano atual.");
    }

    // Downgrade de usuários: não deixar a empresa acima do limite do novo plano.
    if (target.maxUsers != null) {
      const usuarios = await prisma.user.count({
        where: { tenantId: ctx.tenantId, deletedAt: null },
      });
      if (usuarios > target.maxUsers) {
        throw new BusinessRuleError(
          `O plano ${target.name} permite ${target.maxUsers} usuário(s), mas a empresa tem ${usuarios}. Remova usuários antes de trocar.`,
        );
      }
    }

    const updated = await prisma.tenantSubscription.update({
      where: { tenantId: ctx.tenantId },
      data: { planId: target.id, monthlyAmount: target.priceMonthly },
      include: { plan: true },
    });

    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "TenantSubscription",
      entityId: sub.id,
      oldData: { plan: sub.plan?.name ?? null, monthlyAmount: sub.monthlyAmount.toString() },
      newData: { plan: target.name, monthlyAmount: target.priceMonthly.toString() },
      ip: ctx.ip,
    });

    return {
      planName: updated.plan?.name ?? target.name,
      monthlyAmount: Number(updated.monthlyAmount),
    };
  },
};
