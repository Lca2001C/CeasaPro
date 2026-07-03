import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import type { EmpresaInput } from "@/lib/validations/config";
import type { TenantCtx } from "@/lib/http/with-action";

export const ConfigService = {
  async getCompany(tenantId: string) {
    return prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: { include: { plan: true } } },
    });
  },

  async updateCompany(input: EmpresaInput, ctx: TenantCtx) {
    const t = await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        tradeName: input.tradeName,
        legalName: input.legalName ?? null,
        cnpj: input.cnpj ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        businessHours: input.businessHours ?? null,
      },
    });
    await audit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Tenant",
      entityId: ctx.tenantId,
      newData: { tradeName: t.tradeName },
      ip: ctx.ip,
    });
    return t;
  },

  async completeOnboarding(ctx: TenantCtx) {
    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { onboardingCompletedAt: new Date() },
    });
  },
};
