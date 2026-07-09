import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllForTenant } from "@/lib/auth/refresh";
import { audit } from "@/lib/audit";
import { sendEmail, welcomeOwnerEmail } from "@/lib/email";
import { createDefaultExpenseCategories } from "./expense-categories";
import { createDefaultPackagingTypes } from "./embalagens.service";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import type { AdminCtx } from "@/lib/http/with-action";
import type {
  NovaEmpresaInput,
  TenantStatusInput,
  PlanoInput,
  PlanoUpdateInput,
} from "@/lib/validations/admin";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const AdminService = {
  async metrics() {
    const [subs, tenants, recentPayments] = await Promise.all([
      prisma.tenantSubscription.groupBy({ by: ["status"], _count: true }),
      prisma.tenant.count({ where: { deletedAt: null } }),
      prisma.subscriptionPayment.count({ where: { status: "APROVADO" } }),
    ]);
    const mrrRows = await prisma.tenantSubscription.aggregate({
      _sum: { monthlyAmount: true },
      where: { status: { in: ["ATIVO"] } },
    });
    const byStatus: Record<string, number> = {};
    for (const s of subs) byStatus[s.status] = s._count;
    return {
      totalTenants: tenants,
      byStatus,
      mrr: mrrRows._sum.monthlyAmount ?? new Prisma.Decimal(0),
      paymentsApproved: recentPayments,
    };
  },

  async listTenants() {
    return prisma.tenant.findMany({
      where: { deletedAt: null },
      include: { subscription: { include: { plan: true } }, _count: { select: { users: true } } },
      orderBy: { createdAt: "desc" },
    });
  },

  async getTenant(id: string) {
    const t = await prisma.tenant.findUnique({
      where: { id },
      include: {
        subscription: { include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 20 } } },
        users: { where: { deletedAt: null } },
      },
    });
    if (!t) throw new NotFoundError("Empresa não encontrada");
    return t;
  },

  async createTenantWithOwner(input: NovaEmpresaInput, ctx: AdminCtx) {
    const existing = await prisma.user.findFirst({
      where: { email: input.ownerEmail, deletedAt: null },
    });
    if (existing) throw new BusinessRuleError("Já existe um usuário com esse e-mail.");

    const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new NotFoundError("Plano não encontrado");

    const tempPassword = randomBytes(6).toString("base64url");
    const passwordHash = await hashPassword(tempPassword);
    const now = new Date();
    const trialEnd = new Date(now.getTime() + input.trialDays * 24 * 60 * 60 * 1000);

    const tenantId = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          tradeName: input.tradeName,
          legalName: input.legalName ?? null,
          cnpj: input.cnpj ?? null,
          phone: input.phone ?? null,
          status: "ACTIVE",
          subscription: {
            create: {
              planId: plan.id,
              status: input.trialDays > 0 ? "TRIAL" : "ATIVO",
              monthlyAmount: input.monthlyAmount,
              trialEndsAt: input.trialDays > 0 ? trialEnd : null,
              currentPeriodEnd: trialEnd,
              graceDays: input.graceDays,
            },
          },
          users: {
            create: {
              name: input.ownerName,
              email: input.ownerEmail,
              passwordHash,
              role: "OWNER",
              mustChangePassword: true,
            },
          },
        },
      });
      await createDefaultExpenseCategories(tenant.id, tx);
      await createDefaultPackagingTypes(tenant.id, tx);
      await audit(
        {
          tenantId: tenant.id,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "CREATE",
          entity: "Tenant",
          entityId: tenant.id,
          newData: { tradeName: tenant.tradeName, ownerEmail: input.ownerEmail },
          ip: ctx.ip,
        },
        tx,
      );
      return tenant.id;
    });

    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const { subject, html } = welcomeOwnerEmail({
      ownerName: input.ownerName,
      tradeName: input.tradeName,
      email: input.ownerEmail,
      temporaryPassword: tempPassword,
      appUrl: `${appUrl}/login`,
    });
    await sendEmail(input.ownerEmail, subject, html);

    return { tenantId, tempPassword };
  },

  async setTenantStatus(input: TenantStatusInput, ctx: AdminCtx) {
    const t = await prisma.tenant.findUnique({ where: { id: input.tenantId } });
    if (!t) throw new NotFoundError("Empresa não encontrada");

    await prisma.tenant.update({
      where: { id: input.tenantId },
      data: { status: input.status },
    });
    // Bloqueio imediato: derruba sessões ativas da empresa.
    if (input.status !== "ACTIVE") await revokeAllForTenant(input.tenantId);

    await audit({
      tenantId: input.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "STATUS_CHANGE",
      entity: "Tenant",
      entityId: input.tenantId,
      oldData: { status: t.status },
      newData: { status: input.status, reason: input.reason },
      ip: ctx.ip,
    });
    return { status: input.status };
  },

  async updateMonthlyAmount(tenantId: string, monthlyAmount: number, ctx: AdminCtx) {
    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundError("Assinatura não encontrada");
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { monthlyAmount },
    });
    await audit({
      tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "TenantSubscription",
      entityId: sub.id,
      oldData: { monthlyAmount: sub.monthlyAmount.toString() },
      newData: { monthlyAmount },
      ip: ctx.ip,
    });
  },

  async listPlans() {
    return prisma.plan.findMany({ orderBy: { priceMonthly: "asc" } });
  },

  async createPlan(input: PlanoInput) {
    let slug = slugify(input.name) || "plano";
    const clash = await prisma.plan.findUnique({ where: { slug } });
    if (clash) slug = `${slug}-${randomBytes(2).toString("hex")}`;
    return prisma.plan.create({
      data: {
        name: input.name,
        slug,
        priceMonthly: input.priceMonthly,
        maxUsers: input.maxUsers ?? null,
        active: input.active,
      },
    });
  },

  async updatePlan(input: PlanoUpdateInput) {
    return prisma.plan.update({
      where: { id: input.id },
      data: {
        name: input.name,
        priceMonthly: input.priceMonthly,
        maxUsers: input.maxUsers ?? null,
        active: input.active,
      },
    });
  },

  async listPayments() {
    return prisma.subscriptionPayment.findMany({
      include: { subscription: { include: { tenant: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  },
};
