import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllForTenant, revokeAllForUser } from "@/lib/auth/refresh";
import { audit } from "@/lib/audit";
import { startOfMonth } from "@/lib/dates";
import { sendEmail, welcomeOwnerEmail, passwordChangedEmail } from "@/lib/email";
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

/**
 * E-mail "carimbado" de um usuário excluído.
 *
 * `User.email` é `@unique` GLOBAL e o índice não sabe o que é `deletedAt`:
 * a linha excluída continua ocupando o endereço, e cadastrar de novo a mesma
 * pessoa estourava violação de índice único — que chegava à tela como
 * "Ocorreu um erro inesperado (ref: …)".
 *
 * Carimbar libera o endereço para um cadastro novo sem apagar a linha, que
 * precisa continuar existindo porque o `userId` é referenciado na auditoria.
 * O e-mail original fica legível (e também é guardado no log de auditoria).
 */
function emailDeExcluido(userId: string, email: string): string {
  // Já carimbado (exclusão de empresa depois de exclusão de usuário): não
  // empilha prefixo em cima de prefixo.
  if (email.startsWith("excluido-")) return email;
  return `excluido-${userId}-${email}`;
}

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

    // Conta EXCLUÍDA ainda segurando o endereço: libera antes de criar. A
    // migration `20260829120000` já carimbou as antigas, mas isto cobre
    // qualquer linha que tenha escapado — e é justamente onde o cadastro
    // quebrava com "erro inesperado" em vez de uma mensagem.
    const excluido = await prisma.user.findFirst({
      where: { email: input.ownerEmail, deletedAt: { not: null } },
      select: { id: true, email: true },
    });
    if (excluido) {
      await prisma.user.update({
        where: { id: excluido.id },
        data: { email: emailDeExcluido(excluido.id, excluido.email) },
      });
    }

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
   *
   * Os usuários dela vão junto — e os e-mails são liberados. Sem isso, recadastrar
   * o mesmo cliente (caso comum: erro no cadastro, refaz) esbarrava no índice
   * único de `email` de um usuário que, para o sistema, não existe mais.
   */
  async deleteTenant(id: string, ctx: AdminCtx) {
    const t = await prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundError("Empresa não encontrada");
    if (t.deletedAt) return { id }; // idempotente

    const usuarios = await prisma.user.findMany({
      where: { tenantId: id, deletedAt: null },
      select: { id: true, email: true },
    });
    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: { deletedAt: agora, status: "BLOCKED" },
      });
      // Um `updateMany` não serve: cada e-mail recebe um carimbo próprio.
      for (const u of usuarios) {
        await tx.user.update({
          where: { id: u.id },
          data: {
            deletedAt: agora,
            active: false,
            email: emailDeExcluido(u.id, u.email),
            resetTokenHash: null,
            resetTokenExpiresAt: null,
          },
        });
      }
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
      newData: { usuariosExcluidos: usuarios.length },
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

  /**
   * Planos COMERCIAIS. O plano interno do ambiente do super-admin fica de fora:
   * ele existe só porque a assinatura precisa de um `planId`, não é produto —
   * e aparecendo aqui convidava a editar preço e módulos de algo que nenhum
   * cliente contrata.
   */
  async listPlans() {
    return prisma.plan.findMany({
      where: { slug: { not: ADMIN_PLAN_SLUG } },
      orderBy: { priceMonthly: "asc" },
    });
  },

  async createPlan(input: PlanoInput, ctx: AdminCtx) {
    let slug = slugify(input.name) || "plano";
    const clash = await prisma.plan.findUnique({ where: { slug } });
    if (clash) slug = `${slug}-${randomBytes(2).toString("hex")}`;
    const plan = await prisma.plan.create({
      data: {
        name: input.name,
        slug,
        priceMonthly: input.priceMonthly,
        maxUsers: input.maxUsers ?? null,
        active: input.active,
        features: { modules: input.modules },
      },
    });
    await audit({
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "CREATE",
      entity: "Plan",
      entityId: plan.id,
      newData: { name: plan.name, priceMonthly: plan.priceMonthly.toString() },
      ip: ctx.ip,
    });
    return plan;
  },

  async updatePlan(input: PlanoUpdateInput, ctx: AdminCtx) {
    // Buscar antes: sem isto, id inexistente virava P2025 do Prisma e chegava
    // ao usuário como "erro inesperado" em vez de "plano não encontrado".
    const before = await prisma.plan.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Plano não encontrado");
    if (before.slug === ADMIN_PLAN_SLUG) {
      throw new BusinessRuleError(
        "Este é o plano interno do ambiente do administrador e não deve ser editado.",
      );
    }

    const plan = await prisma.plan.update({
      where: { id: input.id },
      data: {
        name: input.name,
        priceMonthly: input.priceMonthly,
        maxUsers: input.maxUsers ?? null,
        active: input.active,
        features: { modules: input.modules },
      },
    });
    await audit({
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "UPDATE",
      entity: "Plan",
      entityId: plan.id,
      oldData: {
        name: before.name,
        priceMonthly: before.priceMonthly.toString(),
        active: before.active,
      },
      newData: {
        name: plan.name,
        priceMonthly: plan.priceMonthly.toString(),
        active: plan.active,
      },
      ip: ctx.ip,
    });
    return plan;
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
  async deletePlan(
    id: string,
    ctx: AdminCtx,
    /**
     * `apagarHistoricoDeExcluidas`: remove também as assinaturas de empresas
     * JÁ EXCLUÍDAS que travam o plano (e os pagamentos delas, por cascata).
     * Existe para limpar plano de teste; nunca toca em empresa ativa.
     */
    opts?: { apagarHistoricoDeExcluidas?: boolean },
  ) {
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundError("Plano não encontrado");
    if (plan.slug === ADMIN_PLAN_SLUG) {
      throw new BusinessRuleError(
        "Este é o plano interno do ambiente do administrador e não pode ser excluído.",
      );
    }

    // A FK é `Restrict`, então QUALQUER assinatura impede a exclusão — inclusive
    // a de empresa já excluída (soft delete mantém a assinatura). Contar as
    // duas coisas separado é o que permite explicar o motivo real: dizer
    // "está em 1 assinatura" sobre um cliente que não existe mais manda o
    // super-admin procurar uma empresa que ele não vai achar em lugar nenhum.
    const [emUsoAtivo, total] = await Promise.all([
      prisma.tenantSubscription.count({
        where: { planId: id, tenant: { deletedAt: null } },
      }),
      prisma.tenantSubscription.count({ where: { planId: id } }),
    ]);

    if (emUsoAtivo > 0) {
      throw new BusinessRuleError(
        `Este plano está em ${emUsoAtivo} assinatura(s) ativa(s) e não pode ser excluído. ` +
          "Desative-o para parar de oferecê-lo — quem já assinou continua como está.",
      );
    }

    if (total > 0) {
      // Só empresas EXCLUÍDAS seguram o plano. É o caso típico da limpeza de
      // teste: criou plano, criou empresa, excluiu a empresa — e a assinatura
      // sobreviveu ao soft delete, travando o plano para sempre.
      if (!opts?.apagarHistoricoDeExcluidas) {
        throw new BusinessRuleError(
          `Nenhuma empresa ativa usa este plano, mas ${total} empresa(s) já excluída(s) ` +
            "ainda guardam o histórico de assinatura nele. Confirme a exclusão do " +
            "histórico para remover o plano.",
        );
      }

      // Apagar a assinatura leva junto os pagamentos dela (FK em cascata) —
      // por isso exige confirmação explícita e só vale para empresa que já foi
      // excluída. De empresa ativa o histórico financeiro nunca é tocado.
      const assinaturas = await prisma.tenantSubscription.findMany({
        where: { planId: id, tenant: { deletedAt: { not: null } } },
        select: { id: true, tenantId: true },
      });
      const pagamentos = await prisma.subscriptionPayment.count({
        where: { subscriptionId: { in: assinaturas.map((a) => a.id) } },
      });
      await prisma.tenantSubscription.deleteMany({
        where: { id: { in: assinaturas.map((a) => a.id) } },
      });
      await audit({
        userId: ctx.userId,
        actorEmail: ctx.session.email,
        action: "DELETE",
        entity: "TenantSubscription",
        entityId: id,
        oldData: {
          motivo: "Limpeza de plano — empresas já excluídas",
          assinaturas: assinaturas.length,
          pagamentos,
        },
        ip: ctx.ip,
      });
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

  /**
   * Todos os usuários da plataforma, com a empresa de cada um.
   *
   * Inclui os super-admins (que aparecem sem empresa ou no próprio ambiente) —
   * aqui a pergunta é "quem tem acesso ao sistema", e omitir quem administra
   * seria justamente esconder o acesso mais poderoso.
   */
  async listUsers(filtro?: { busca?: string; somenteInativos?: boolean }) {
    const busca = filtro?.busca?.trim();
    return prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(filtro?.somenteInativos ? { active: false } : {}),
        ...(busca
          ? {
              OR: [
                { name: { contains: busca, mode: "insensitive" as const } },
                { email: { contains: busca, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: { tenant: { select: { id: true, tradeName: true, deletedAt: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      take: 200,
    });
  },

  /**
   * Liga/desliga o acesso de um usuário.
   *
   * Desativar **revoga as sessões abertas** na hora: sem isso o usuário
   * continuaria usando o sistema até o refresh token expirar, que é o oposto
   * do que "desativar" promete.
   */
  async setUserActive(input: { userId: string; active: boolean }, ctx: AdminCtx) {
    const user = await prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
    });
    if (!user) throw new NotFoundError("Usuário não encontrado");
    if (user.id === ctx.userId && !input.active) {
      throw new BusinessRuleError("Você não pode desativar a própria conta.");
    }
    if (user.active === input.active) return { id: user.id, active: user.active };

    await prisma.user.update({
      where: { id: user.id },
      data: { active: input.active },
    });
    if (!input.active) await revokeAllForUser(user.id);

    await audit({
      tenantId: user.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "STATUS_CHANGE",
      entity: "User",
      entityId: user.id,
      oldData: { active: user.active },
      newData: { active: input.active, sessoesRevogadas: !input.active },
      ip: ctx.ip,
    });
    return { id: user.id, active: input.active };
  },

  /**
   * Gera uma senha temporária e obriga a troca no próximo login.
   *
   * O super-admin nunca vê nem escolhe a senha definitiva de ninguém: a
   * temporária é aleatória, entregue uma única vez na tela, e `mustChangePassword`
   * força o dono a definir a dele. As sessões abertas caem junto — se o motivo
   * do reset foi conta comprometida, deixar a sessão viva não resolveria nada.
   */
  async resetUserPassword(userId: string, ctx: AdminCtx) {
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundError("Usuário não encontrado");

    const tempPassword = randomBytes(6).toString("base64url");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });
    await revokeAllForUser(user.id);

    await audit({
      tenantId: user.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "PASSWORD_RESET",
      entity: "User",
      entityId: user.id,
      newData: { porSuperAdmin: true, sessoesRevogadas: true },
      ip: ctx.ip,
    });

    // Melhor esforço: se o e-mail não sair, a senha ainda aparece na tela.
    const mail = passwordChangedEmail({ loginUrl: absoluteUrl("/login") });
    await sendEmail(user.email, mail.subject, mail.html);

    return { id: user.id, name: user.name, email: user.email, tempPassword };
  },

  /**
   * Exclui um usuário (soft delete) e derruba as sessões dele.
   *
   * É soft delete porque o `userId` aparece na auditoria: apagar a linha
   * deixaria o histórico apontando para o nada, e é justamente o histórico de
   * quem fez o quê que a auditoria existe para guardar.
   *
   * Duas recusas: a própria conta (travaria o painel) e o **último OWNER ativo**
   * de uma empresa em atividade — sem OWNER ninguém entra naquela empresa, e a
   * exclusão viraria um bloqueio acidental do cliente.
   */
  async deleteUser(userId: string, ctx: AdminCtx) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { tenant: { select: { deletedAt: true, tradeName: true } } },
    });
    if (!user) throw new NotFoundError("Usuário não encontrado");
    if (user.id === ctx.userId) {
      throw new BusinessRuleError("Você não pode excluir a própria conta.");
    }

    if (user.role === "OWNER" && user.tenantId && !user.tenant?.deletedAt) {
      const outros = await prisma.user.count({
        where: {
          tenantId: user.tenantId,
          role: "OWNER",
          active: true,
          deletedAt: null,
          id: { not: user.id },
        },
      });
      if (outros === 0) {
        throw new BusinessRuleError(
          `${user.name} é o único acesso de "${user.tenant?.tradeName}". ` +
            "Excluir deixaria a empresa sem ninguém para entrar — exclua a empresa " +
            "ou cadastre outro responsável antes.",
        );
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        deletedAt: new Date(),
        active: false,
        // Libera o endereço para um cadastro novo (ver `emailDeExcluido`).
        email: emailDeExcluido(user.id, user.email),
        // Um link de recuperação pendente não pode sobreviver à exclusão.
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });
    await revokeAllForUser(user.id);

    await audit({
      tenantId: user.tenantId,
      userId: ctx.userId,
      actorEmail: ctx.session.email,
      action: "DELETE",
      entity: "User",
      entityId: user.id,
      oldData: { name: user.name, email: user.email, role: user.role },
      ip: ctx.ip,
    });
    return { id: user.id, name: user.name };
  },

  async listPayments() {
    return prisma.subscriptionPayment.findMany({
      include: { subscription: { include: { tenant: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  },
};
