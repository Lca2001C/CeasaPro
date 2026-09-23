import type { Plan } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { planModules, OPTIONAL_MODULES, ALL_OPTIONAL_KEYS } from "@/lib/plan/modules";
import type { OptionalModuleKey } from "@/lib/plan/modules";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { refMonthTz } from "@/lib/tz";
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
  /** Troca de plano já contratada que passa a valer na próxima competência. */
  pendingPlan: { id: string; name: string; priceMonthly: number; from: Date } | null;
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

export interface ChangePlanResult {
  planName: string;
  monthlyAmount: number;
  /**
   * `true` quando a troca foi AGENDADA em vez de aplicada — acontece sempre que
   * a competência corrente já está paga. Ver `changePlan`.
   */
  scheduled: boolean;
  /** Quando a troca agendada passa a valer (null quando valeu na hora). */
  effectiveFrom: Date | null;
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

/** Assinatura mínima que a aplicação da troca agendada precisa enxergar. */
export interface SubComTrocaAgendada {
  id: string;
  tenantId: string;
  planId: string;
  pendingPlanId: string | null;
  pendingPlanFrom: Date | null;
}

/** Existe mensalidade APROVADA para a competência corrente? */
async function competenciaJaPaga(tenantId: string, now: Date): Promise<boolean> {
  const pago = await prisma.subscriptionPayment.findFirst({
    // `refMonthTz` e não `getMonth()`: em UTC o servidor já está no mês seguinte
    // a partir das 21h do último dia, e a competência olhada aqui precisa ser a
    // mesma que o billing cobra.
    where: { tenantId, referenceMonth: refMonthTz(now), status: "APROVADO" },
    select: { id: true },
  });
  return pago !== null;
}

export const PlanoService = {
  async getPlanoView(tenantId: string, now = new Date()): Promise<PlanoView | null> {
    const atual = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { plan: true, pendingPlan: true },
    });
    if (!atual) return null;

    // A troca agendada vence pelo relógio, e ninguém garante que o cron rodou
    // antes desta tela abrir. Aplicar aqui é o que impede a página de anunciar
    // como vigente um plano que já deixou de ser.
    const aplicado = await this.aplicarTrocaProgramada(atual, now);
    const sub = aplicado
      ? await prisma.tenantSubscription.findUniqueOrThrow({
          where: { tenantId },
          include: { plan: true, pendingPlan: true },
        })
      : atual;

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
      pendingPlan:
        sub.pendingPlan && sub.pendingPlanFrom
          ? {
              id: sub.pendingPlan.id,
              name: sub.pendingPlan.name,
              priceMonthly: Number(sub.pendingPlan.priceMonthly),
              from: sub.pendingPlanFrom,
            }
          : null,
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
      where: {
        /*
          O plano interno do super-admin NUNCA entra — nem como "plano atual" do
          próprio ambiente administrativo.

          Ele é gratuito (R$ 0) e nasce com vencimento a 50 anos. A única coisa
          que o mantinha fora desta lista era `active: false`, e isso é um estado
          que um seed, um script de migração ou um clique no painel viram sem
          cerimônia — a partir daí ele apareceria como o plano mais barato da
          vitrine de troca e qualquer cliente poderia contratá-lo, ganhando o
          sistema inteiro de graça. Filtrar pelo slug tira a aposta.
        */
        slug: { not: ADMIN_PLAN_SLUG },
        // O plano ATUAL entra mesmo desativado. Um plano tirado de oferta sumia
        // desta lista, a tela de assinatura selecionava outro por falta de opção
        // e o pagamento virava uma troca de plano silenciosa — que ainda podia
        // virar uma troca de plano silenciosa para quem só queria pagar a
        // mensalidade.
        ...(currentPlanId ? { OR: [{ active: true }, { id: currentPlanId }] } : { active: true }),
      },
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
   *
   * Regras (autoritativas no servidor):
   *  - só planos existentes e ativos, e **nunca** o plano interno do super-admin;
   *  - o valor mensal vem SEMPRE do plano (nunca do cliente);
   *  - competência corrente **em aberto** ⇒ a troca vale na hora, e o novo valor
   *    é cobrado na próxima cobrança (não há proporcional nesta versão);
   *  - competência corrente **já paga** ⇒ a troca é AGENDADA para
   *    `currentPeriodEnd`, o primeiro instante da competência seguinte.
   *
   * Por que o agendamento existe
   * ----------------------------
   * A mensalidade compra o mês inteiro, e é o plano que decide quais módulos
   * valem nesse mês. Com a troca valendo na hora, quem pagasse o básico no dia 1º
   * e trocasse para o completo no dia 2 usava Cotações, Caixas e Higienização o
   * mês todo pelo preço do básico — o valor novo só apareceria na renovação
   * seguinte, que a pessoa evitaria repetindo a manobra. Era upgrade sem cobrança
   * do delta, indefinidamente.
   *
   * O downgrade é adiado pelo mesmo raciocínio, ao contrário: tirar na hora
   * módulos que o cliente acabou de pagar seria receber o mês e entregar meio.
   *
   * Não altera status/vencimento/origem (respeita eventual bloqueio manual do
   * super-admin).
   */
  async changePlan(planId: string, ctx: TenantCtx, now = new Date()): Promise<ChangePlanResult> {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: ctx.tenantId },
      include: { plan: true, pendingPlan: true },
    });
    if (!sub) throw new NotFoundError("Assinatura não encontrada");
    if (sub.cancelledAt) {
      throw new BusinessRuleError(
        "A assinatura está cancelada. Desfaça o cancelamento ou contrate de novo antes de trocar de plano.",
      );
    }

    const target = await prisma.plan.findUnique({ where: { id: planId } });
    // Mesma recusa para inexistente, inativo e plano interno: de fora, os três
    // são a mesma coisa — não é um plano que se contrata — e diferenciar só
    // revelaria a existência do ambiente administrativo a quem sondasse ids.
    if (!target || !target.active || target.slug === ADMIN_PLAN_SLUG) {
      if (target?.slug === ADMIN_PLAN_SLUG) {
        logger.warn(
          { tenantId: ctx.tenantId, userId: ctx.userId },
          "Tentativa de contratar o plano interno do ambiente do super-admin — recusada",
        );
      }
      throw new NotFoundError("Plano indisponível");
    }

    // Escolher de novo o plano vigente é como se desfaz um agendamento: não há
    // tela separada para isso, e criar uma exigiria ensinar ao cliente um
    // conceito que ele não tem.
    if (target.id === sub.planId) {
      if (sub.pendingPlanId) {
        await this.cancelarTrocaProgramada(ctx);
        return {
          planName: sub.plan?.name ?? target.name,
          monthlyAmount: Number(sub.monthlyAmount),
          scheduled: false,
          effectiveFrom: null,
        };
      }
      throw new BusinessRuleError("Este já é o seu plano atual.");
    }
    // O que protege é o PERÍODO comprado, não o mês do calendário. Olhar só a
    // competência corrente deixava a brecha que o agendamento existe para
    // fechar: pagar o básico em 31/08 (período até 30/09), subir para o
    // completo em 01/09 — setembro ainda sem pagamento, então valia na hora —
    // usar o mês inteiro e descer de novo antes de pagar. `activatedAt` separa
    // o período pago do trial e do vencimento que o admin grava na criação.
    // Período já vencido não dá direito a nada: troca na hora, e a próxima
    // cobrança sai pelo plano novo.
    const agendar =
      (sub.activatedAt !== null && sub.currentPeriodEnd > now) ||
      (sub.currentPeriodEnd > now && (await competenciaJaPaga(ctx.tenantId, now)));

    // Pedir de novo o plano que já está agendado: é erro enquanto o mês pago
    // corre (não há nada a fazer além do que já foi feito), mas deixa de ser
    // assim que a competência abre — aí o pedido é simplesmente "quero agora", e
    // recusá-lo prenderia o cliente esperando o cron por nada.
    if (target.id === sub.pendingPlanId && agendar) {
      throw new BusinessRuleError("A troca para este plano já está agendada.");
    }

    if (agendar) {
      await prisma.$transaction(async (tx) => {
        await tx.tenantSubscription.update({
          where: { tenantId: ctx.tenantId },
          data: { pendingPlanId: target.id, pendingPlanFrom: sub.currentPeriodEnd },
        });
        await audit(
          {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            actorEmail: ctx.session.email,
            action: "UPDATE",
            entity: "TenantSubscription",
            entityId: sub.id,
            oldData: { plan: sub.plan?.name ?? null, pendingPlan: sub.pendingPlan?.name ?? null },
            newData: {
              pendingPlan: target.name,
              pendingPlanFrom: sub.currentPeriodEnd.toISOString(),
              motivo: "competencia-ja-paga",
            },
            ip: ctx.ip,
          },
          tx,
        );
      });

      logger.info(
        {
          tenantId: ctx.tenantId,
          de: sub.plan?.name,
          para: target.name,
          valeApartirDe: sub.currentPeriodEnd,
        },
        "Troca de plano agendada — a competência corrente já está paga",
      );

      return {
        planName: sub.plan?.name ?? "—",
        monthlyAmount: Number(sub.monthlyAmount),
        scheduled: true,
        effectiveFrom: sub.currentPeriodEnd,
      };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.tenantSubscription.update({
        where: { tenantId: ctx.tenantId },
        data: {
          planId: target.id,
          monthlyAmount: target.priceMonthly,
          // Agendamento anterior perde o sentido: o cliente acabou de dizer qual
          // plano quer, e deixá-lo de pé trocaria o plano de novo sozinho.
          pendingPlanId: null,
          pendingPlanFrom: null,
        },
        include: { plan: true },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "TenantSubscription",
          entityId: sub.id,
          oldData: { plan: sub.plan?.name ?? null, monthlyAmount: sub.monthlyAmount.toString() },
          newData: { plan: target.name, monthlyAmount: target.priceMonthly.toString() },
          ip: ctx.ip,
        },
        tx,
      );
      return row;
    });

    return {
      planName: updated.plan?.name ?? target.name,
      monthlyAmount: Number(updated.monthlyAmount),
      scheduled: false,
      effectiveFrom: null,
    };
  },

  /** Desfaz uma troca agendada; a empresa segue no plano vigente. */
  async cancelarTrocaProgramada(ctx: TenantCtx) {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: ctx.tenantId },
      include: { pendingPlan: true },
    });
    if (!sub) throw new NotFoundError("Assinatura não encontrada");
    if (!sub.pendingPlanId) {
      throw new BusinessRuleError("Não há troca de plano agendada.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.tenantSubscription.update({
        where: { tenantId: ctx.tenantId },
        data: { pendingPlanId: null, pendingPlanFrom: null },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "UPDATE",
          entity: "TenantSubscription",
          entityId: sub.id,
          oldData: {
            pendingPlan: sub.pendingPlan?.name ?? null,
            pendingPlanFrom: sub.pendingPlanFrom?.toISOString() ?? null,
          },
          newData: { pendingPlan: null },
          ip: ctx.ip,
        },
        tx,
      );
    });

    return { ok: true as const };
  },

  /**
   * Faz valer a troca agendada assim que a competência paga termina.
   *
   * Chamada de todo lugar que precisa do plano CERTO e não pode esperar o cron
   * do dia seguinte: a emissão do token (é o claim `modules` que libera ou barra
   * o módulo), o preparo da cobrança (é o valor que vai ao Mercado Pago) e a
   * tela de plano. Recebe a assinatura já carregada porque todos esses
   * chamadores acabaram de lê-la — cobrar uma consulta a mais em cada login
   * seria pagar caro por nada.
   *
   * Devolve o plano que passou a valer, ou `null` quando não havia o que aplicar.
   */
  async aplicarTrocaProgramada(sub: SubComTrocaAgendada, now = new Date()): Promise<Plan | null> {
    if (!sub.pendingPlanId || !sub.pendingPlanFrom) return null;
    if (sub.pendingPlanFrom > now) return null;

    const alvo = await prisma.plan.findUnique({ where: { id: sub.pendingPlanId } });
    if (!alvo || !alvo.active) {
      // O plano saiu de oferta entre a contratação e a virada da competência.
      // Descartar o agendamento é o único caminho que não prende a empresa: ela
      // segue no plano vigente, que é o que vinha usando e pagando.
      logger.warn(
        { tenantId: sub.tenantId, pendingPlanId: sub.pendingPlanId },
        "Troca de plano agendada descartada: o plano não existe mais ou saiu de oferta",
      );
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { pendingPlanId: null, pendingPlanFrom: null },
      });
      return null;
    }

    const aplicou = await prisma.$transaction(async (tx) => {
      // `pendingPlanId` no filtro fecha a corrida entre o cron e um login que
      // chegue no mesmo segundo: só um dos dois encontra linha para atualizar.
      const { count } = await tx.tenantSubscription.updateMany({
        where: { id: sub.id, pendingPlanId: alvo.id },
        data: {
          planId: alvo.id,
          monthlyAmount: alvo.priceMonthly,
          pendingPlanId: null,
          pendingPlanFrom: null,
        },
      });
      if (count !== 1) return false;
      await audit(
        {
          tenantId: sub.tenantId,
          action: "UPDATE",
          entity: "TenantSubscription",
          entityId: sub.id,
          oldData: { planId: sub.planId },
          newData: {
            plan: alvo.name,
            monthlyAmount: alvo.priceMonthly.toString(),
            motivo: "troca-agendada-aplicada",
          },
        },
        tx,
      );
      return true;
    });

    if (!aplicou) return null;
    logger.info(
      { tenantId: sub.tenantId, plano: alvo.name },
      "Troca de plano agendada aplicada na virada da competência",
    );
    return alvo;
  },
};
