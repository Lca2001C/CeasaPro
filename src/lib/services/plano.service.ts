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
  cancelledAt: Date | null;
  modules: { key: OptionalModuleKey; label: string; description: string; enabled: boolean }[];
  usage: { produtos: number };
}

/** Plano ofertado ao cliente para troca (dados já serializáveis para o cliente). */
export interface AvailablePlan {
  id: string;
  name: string;
  priceMonthly: number;
  /** Rótulos dos módulos opcionais incluídos neste plano. */
  modules: string[];
  isCurrent: boolean;
}

/**
 * Plano interno do ambiente do super-admin. Não é produto: não pode aparecer na
 * vitrine pública nem ser o plano de entrada de um cadastro.
 *
 * Exportado porque três lugares precisam do mesmo valor (`AdminService`, a
 * vitrine pública e o cadastro). Cópias soltas divergiriam e o plano interno
 * vazaria para a tela de preços.
 */
export const ADMIN_PLAN_SLUG = "ambiente-administrador";

export const PlanoService = {
  async getPlanoView(tenantId: string): Promise<PlanoView | null> {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (!sub) return null;

    const db = getTenantPrisma(tenantId);
    const produtos = await db.product.count();

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
      cancelledAt: sub.cancelledAt,
      modules,
      usage: { produtos },
    };
  },

  /**
   * Planos para a VITRINE pública (landing page). Sem sessão e sem tenant.
   *
   * Lê do banco em vez de repetir os preços no código da landing: a segunda
   * fonte de verdade divergiria no primeiro reajuste, e o lugar onde isso
   * apareceria é a página que o cliente vê antes de decidir.
   *
   * O plano interno do ambiente do super-admin fica fora — não é oferta.
   */
  async listPublicPlans(): Promise<AvailablePlan[]> {
    const plans = await prisma.plan.findMany({
      where: { active: true, slug: { not: ADMIN_PLAN_SLUG } },
      orderBy: { priceMonthly: "asc" },
    });

    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceMonthly: Number(p.priceMonthly),
      modules: planModules(p.features).map((k) => OPTIONAL_MODULES[k].label),
      isCurrent: false,
    }));
  },

  /** Planos ativos que o cliente pode contratar (o atual vem marcado com isCurrent). */
  async listAvailablePlans(tenantId: string): Promise<AvailablePlan[]> {
    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    const currentPlanId = sub?.planId ?? null;

    const plans = await prisma.plan.findMany({
      // O plano ATUAL entra mesmo desativado. Um plano tirado de oferta sumia
      // desta lista, a tela de assinatura selecionava outro por falta de opção
      // e o pagamento virava uma troca de plano silenciosa — que ainda podia
      // virar uma troca de plano silenciosa para quem só queria pagar a
      // mensalidade.
      where: currentPlanId ? { OR: [{ active: true }, { id: currentPlanId }] } : { active: true },
      orderBy: { priceMonthly: "asc" },
    });

    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceMonthly: Number(p.priceMonthly),
      modules: planModules(p.features).map((k) => OPTIONAL_MODULES[k].label),
      isCurrent: p.id === currentPlanId,
    }));
  },

  /**
   * Troca a assinatura da empresa para outro plano ATIVO.
   * Regras (autoritativas no servidor):
   *  - só planos existentes e ativos; nunca o plano atual;
   *  - o valor mensal vem SEMPRE do plano (nunca do cliente);
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
    if (sub.cancelledAt) {
      throw new BusinessRuleError(
        "A assinatura está cancelada. Desfaça o cancelamento ou contrate de novo antes de trocar de plano.",
      );
    }

    const target = await prisma.plan.findUnique({ where: { id: planId } });
    if (!target || !target.active) throw new NotFoundError("Plano indisponível");
    if (target.id === sub.planId) {
      throw new BusinessRuleError("Este já é o seu plano atual.");
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
