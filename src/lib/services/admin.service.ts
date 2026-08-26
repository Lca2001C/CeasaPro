import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllForTenant } from "@/lib/auth/refresh";
import { audit } from "@/lib/audit";
import { startOfMonth } from "@/lib/dates";
import { sendEmail, welcomeOwnerEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/app-url";
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

/**
 * O ambiente próprio do super-admin é um tenant como outro qualquer no banco —
 * o que o distingue é ter um usuário SUPER_ADMIN. Não é cliente: não pode
 * entrar nas métricas de negócio (MRR, inadimplência), na lista de clientes
 * nem nos relatórios da plataforma, senão o painel mente sobre o próprio negócio.
 *
 * Identificar pelo papel do usuário evita uma coluna nova só para isto, e é
 * verdade por construção: nenhum cliente tem SUPER_ADMIN.
 */
const NAO_E_AMBIENTE_ADMIN = { users: { none: { role: "SUPER_ADMIN" as const } } };

/** Nome do plano interno usado pelo ambiente do super-admin. */
const ADMIN_PLAN_SLUG = "ambiente-administrador";

export const AdminService = {
  async metrics() {
    // Início do mês no fuso do app: em UTC, "novos clientes no mês" e "recebido
    // no mês" começavam às 21h do último dia do mês anterior.
    const monthStart = startOfMonth(new Date());

    const [subs, tenants, recentPayments, mrrRows, novosNoMes, receitaMes, aguardandoAtivacao] =
      await Promise.all([
        prisma.tenantSubscription.groupBy({
          by: ["status"],
          _count: true,
          where: { tenant: NAO_E_AMBIENTE_ADMIN },
        }),
        prisma.tenant.count({ where: { deletedAt: null, ...NAO_E_AMBIENTE_ADMIN } }),
        prisma.subscriptionPayment.count({ where: { status: "APROVADO" } }),
        prisma.tenantSubscription.aggregate({
          _sum: { monthlyAmount: true },
          where: { status: { in: ["ATIVO"] }, tenant: NAO_E_AMBIENTE_ADMIN },
        }),
        prisma.tenant.count({
          where: { deletedAt: null, createdAt: { gte: monthStart }, ...NAO_E_AMBIENTE_ADMIN },
        }),
        prisma.subscriptionPayment.aggregate({
          _sum: { amount: true },
          where: { status: "APROVADO", paidAt: { gte: monthStart } },
        }),
        // Empresas cadastradas que ainda nao tiveram nenhum pagamento aprovado.
        prisma.tenantSubscription.count({
          where: {
            activatedAt: null,
            tenant: { deletedAt: null, ...NAO_E_AMBIENTE_ADMIN },
          },
        }),
      ]);
    const byStatus: Record<string, number> = {};
    for (const s of subs) byStatus[s.status] = s._count;
    return {
      totalTenants: tenants,
      byStatus,
      mrr: mrrRows._sum.monthlyAmount ?? new Prisma.Decimal(0),
      paymentsApproved: recentPayments,
      novosNoMes,
      receitaMes: receitaMes._sum.amount ?? new Prisma.Decimal(0),
      aguardandoAtivacao,
    };
  },

  async listTenants() {
    return prisma.tenant.findMany({
      where: { deletedAt: null, ...NAO_E_AMBIENTE_ADMIN },
      include: { subscription: { include: { plan: true } }, _count: { select: { users: true } } },
      orderBy: { createdAt: "desc" },
    });
  },

  async getTenant(id: string) {
    const t = await prisma.tenant.findFirst({
      where: { id, deletedAt: null, ...NAO_E_AMBIENTE_ADMIN },
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
              // Sem periodo gratuito: a empresa nasce bloqueada e so vai para
              // ATIVO quando o Mercado Pago aprovar a primeira mensalidade.
              status: "SUSPENSO",
              monthlyAmount: input.monthlyAmount,
              activatedAt: null,
              currentPeriodEnd: now,
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

    const { subject, html } = welcomeOwnerEmail({
      ownerName: input.ownerName,
      tradeName: input.tradeName,
      email: input.ownerEmail,
      temporaryPassword: tempPassword,
      appUrl: absoluteUrl("/login"),
    });
    await sendEmail(input.ownerEmail, subject, html);

    return { tenantId, tempPassword };
  },

  /**
   * Devolve (criando na primeira vez) o **ambiente próprio** do super-admin: um
   * tenant onde ele usa o sistema como qualquer cliente, para testar uma conta,
   * conferir um cálculo ou demonstrar a ferramenta.
   *
   * Nunca é o tenant de um cliente: os dados de quem paga continuam fora do
   * alcance do login administrativo, o que mantém a separação exigida pela LGPD
   * (o admin vê o cadastro e a cobrança do cliente em `/admin`, não o movimento
   * dele). O ambiente é excluído das métricas por `NAO_E_AMBIENTE_ADMIN`.
   *
   * A assinatura nasce `ATIVO` com `statusSource: MANUAL` e vencimento distante:
   * MANUAL faz `computeStatus` respeitar o valor, então o cron diário não
   * expira o ambiente. É idempotente — chamar de novo devolve o mesmo tenant.
   */
  async getOrCreateAdminWorkspace(ctx: AdminCtx): Promise<{ tenantId: string; criado: boolean }> {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, name: true, tenantId: true },
    });
    if (!user) throw new NotFoundError("Usuário não encontrado");

    if (user.tenantId) {
      const existente = await prisma.tenant.findFirst({
        where: { id: user.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (existente) return { tenantId: existente.id, criado: false };
      // Ambiente apagado por fora: cai adiante e provisiona outro.
    }

    // Plano interno INATIVO: `listAvailablePlans` só oferta planos ativos, então
    // ele nunca aparece para um cliente — mas a FK de assinatura exige um plano.
    const plan =
      (await prisma.plan.findUnique({ where: { slug: ADMIN_PLAN_SLUG } })) ??
      (await prisma.plan.create({
        data: {
          name: "Ambiente do administrador",
          slug: ADMIN_PLAN_SLUG,
          priceMonthly: 0,
          maxUsers: null,
          active: false,
          features: {},
        },
      }));

    // Bem longe: o ambiente não deve "vencer" no meio de um teste.
    const periodEnd = new Date();
    periodEnd.setFullYear(periodEnd.getFullYear() + 50);

    const tenantId = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          tradeName: `Ambiente de ${user.name}`,
          status: "ACTIVE",
          // Já pronto para uso: o wizard de onboarding é para o cliente novo,
          // não para quem administra a plataforma.
          onboardingCompletedAt: new Date(),
          subscription: {
            create: {
              planId: plan.id,
              status: "ATIVO",
              statusSource: "MANUAL",
              statusReason: "Ambiente interno do super-admin",
              monthlyAmount: 0,
              activatedAt: new Date(),
              currentPeriodEnd: periodEnd,
              graceDays: 0,
            },
          },
        },
      });
      // Liga o super-admin ao ambiente: é o `tenantId` da sessão dele daqui em diante.
      await tx.user.update({
        where: { id: user.id },
        data: { tenantId: tenant.id },
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
          newData: { tradeName: tenant.tradeName, ambienteAdmin: true },
          ip: ctx.ip,
        },
        tx,
      );
      return tenant.id;
    });

    return { tenantId, criado: true };
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

  /**
   * Exclui uma empresa (SOFT DELETE): marca deletedAt, bloqueia e derruba as sessões.
   * Preserva dados/histórico/auditoria (o AuditLog não tem FK com Tenant, por design).
   * listTenants/metrics já filtram deletedAt, então some da UI automaticamente.
   */
  async deleteTenant(id: string, ctx: AdminCtx) {
    const t = await prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundError("Empresa não encontrada");
    if (t.deletedAt) return { id }; // idempotente

    await prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date(), status: "BLOCKED" },
    });
    await revokeAllForTenant(id);

    await audit({
      tenantId: id,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "Tenant",
      entityId: id,
      oldData: { status: t.status, tradeName: t.tradeName },
      ip: ctx.ip,
    });
    return { id };
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
        features: { modules: input.modules },
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
        features: { modules: input.modules },
      },
    });
  },

  /**
   * Exclui um plano DEFINITIVAMENTE.
   *
   * Só é permitido para plano que nenhuma assinatura usa — nem ativa, nem
   * cancelada. `TenantSubscription.planId` é obrigatório e a FK é `Restrict`, e
   * mesmo que não fosse: apagar o plano de uma empresa apagaria a prova de
   * quanto e por qual pacote ela pagou. Para tirar de circulação um plano já
   * contratado, o caminho é **desativar** (`active: false`), que o esconde da
   * oferta sem tocar em quem já assinou.
   */
  async deletePlan(id: string, ctx: AdminCtx) {
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundError("Plano não encontrado");

    const emUso = await prisma.tenantSubscription.count({ where: { planId: id } });
    if (emUso > 0) {
      throw new BusinessRuleError(
        `Este plano está em ${emUso} assinatura(s) e não pode ser excluído. ` +
          "Desative-o para parar de oferecê-lo — quem já assinou continua como está.",
      );
    }

    await prisma.plan.delete({ where: { id } });
    await audit({
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "Plan",
      entityId: id,
      oldData: {
        name: plan.name,
        slug: plan.slug,
        priceMonthly: plan.priceMonthly.toString(),
        active: plan.active,
      },
      ip: ctx.ip,
    });
    return { id, name: plan.name };
  },

  async listPayments() {
    return prisma.subscriptionPayment.findMany({
      include: { subscription: { include: { tenant: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  },
};
