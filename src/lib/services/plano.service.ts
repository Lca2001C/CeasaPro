import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { planModules, OPTIONAL_MODULES, ALL_OPTIONAL_KEYS } from "@/lib/plan/modules";
import type { OptionalModuleKey } from "@/lib/plan/modules";

export interface PlanoView {
  planName: string;
  priceMonthly: unknown; // Prisma.Decimal (formatado na borda)
  status: string;
  currentPeriodEnd: Date | null;
  maxUsers: number | null;
  modules: { key: OptionalModuleKey; label: string; description: string; enabled: boolean }[];
  usage: { produtos: number; usuarios: number };
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
};
