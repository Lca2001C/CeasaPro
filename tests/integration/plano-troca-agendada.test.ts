import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { PlanoService, ADMIN_PLAN_SLUG } from "@/lib/services/plano.service";
import { BillingService, valorDevido } from "@/lib/services/billing.service";
import { AdminService } from "@/lib/services/admin.service";
import { buildAccessPayload } from "@/lib/auth/build-session";
import { planModules } from "@/lib/plan/modules";
import { refMonthTz } from "@/lib/tz";
import { ValidationError } from "@/lib/http/app-error";
import { createTestTenant, cleanupTenants, makeCtx, makeAdminCtx } from "../helpers/factory";
import type { PlanoInput } from "@/lib/validations/admin";

/**
 * Travas de receita na troca de plano.
 *
 * Duas brechas da auditoria moram aqui, e as duas são sobre o mesmo descompasso:
 * a mensalidade compra o MÊS, mas a troca de plano valia no INSTANTE.
 *
 *  1. Quem já pagou a competência subia de plano no dia seguinte e usava o mês
 *     inteiro pelo preço do plano barato — o valor novo só apareceria na
 *     renovação, que a manobra repetida adiava para sempre.
 *  2. O plano interno do ambiente do super-admin (R$ 0, vencimento a 50 anos) só
 *     ficava fora da vitrine por estar `active: false`. Um clique, um seed ou um
 *     script bastava para ele virar o plano mais barato da lista — e o sistema
 *     inteiro de graça para qualquer cliente.
 */

const uniq = () => Math.random().toString(36).slice(2, 8);

const tenants: string[] = [];
const planIds: string[] = [];
let basicoId = "";
let completoId = "";
let adminPlanId = "";

/** Empresa ATIVA, com período pago em aberto e um dono. */
async function empresaPagante(opts?: { periodEnd?: Date; semPagamento?: boolean }): Promise<string> {
  const tenantId = await createTestTenant("TROCA AGENDADA");
  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: basicoId,
      // `semPagamento`: nunca pagou (trial) — não há período comprado a proteger.
      status: opts?.semPagamento ? "TRIAL" : "ATIVO",
      monthlyAmount: 29.9,
      activatedAt: opts?.semPagamento ? null : new Date(),
      trialEndsAt: opts?.semPagamento ? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) : null,
      currentPeriodEnd: opts?.periodEnd ?? new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      graceDays: 5,
    },
  });
  await prisma.user.create({
    data: {
      tenantId,
      name: "Dono",
      email: `agenda-${uniq()}@teste-ceasapro.com.br`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  tenants.push(tenantId);
  return tenantId;
}

/** Marca a competência corrente como paga (é a condição que dispara o agendamento). */
async function pagarCompetencia(tenantId: string, amount = 29.9) {
  const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
  const referenceMonth = refMonthTz(new Date());
  return prisma.subscriptionPayment.create({
    data: {
      subscriptionId: sub.id,
      tenantId,
      amount,
      status: "APROVADO",
      method: "PIX",
      referenceMonth,
      mpPaymentId: `pago-${uniq()}`,
      approvedKey: `${tenantId}:${referenceMonth}`,
      paidAt: new Date(),
      periodStart: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      periodEnd: sub.currentPeriodEnd,
    },
  });
}

beforeAll(async () => {
  const basico = await prisma.plan.create({
    data: {
      name: "Básico Agenda",
      slug: `basico-ag-${uniq()}`,
      priceMonthly: 29.9,
      active: true,
      features: { modules: [] },
    },
  });
  const completo = await prisma.plan.create({
    data: {
      name: "Completo Agenda",
      slug: `completo-ag-${uniq()}`,
      priceMonthly: 99.9,
      active: true,
      features: { modules: ["caixas", "higienizacao", "cotacoes"] },
    },
  });
  basicoId = basico.id;
  completoId = completo.id;
  planIds.push(basicoId, completoId);
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
  // O plano interno é criado sob demanda pelo `getOrCreateAdminWorkspace` e é
  // global: só apaga se foi este arquivo que o trouxe à existência.
  if (adminPlanId) {
    await prisma.plan.delete({ where: { id: adminPlanId } }).catch(() => {});
  }
});

describe("O plano interno do super-admin não é produto", () => {
  beforeEach(async () => {
    const existente = await prisma.plan.findUnique({ where: { slug: ADMIN_PLAN_SLUG } });
    if (!existente) {
      const criado = await prisma.plan.create({
        data: {
          name: "Ambiente do administrador",
          slug: ADMIN_PLAN_SLUG,
          priceMonthly: 0,
          active: false,
          features: { modules: [] },
        },
      });
      adminPlanId = criado.id;
    }
  });

  it("changePlan recusa o plano interno mesmo quando ele está ATIVO", async () => {
    // O cenário que a auditoria apontou: basta alguém marcá-lo como ativo.
    // Enquanto `active: false` era a única defesa, isso era um clique de
    // distância do sistema inteiro de graça — R$ 0 por 50 anos.
    const plano = await prisma.plan.update({
      where: { slug: ADMIN_PLAN_SLUG },
      data: { active: true },
    });
    try {
      const tenantId = await empresaPagante();
      await expect(PlanoService.changePlan(plano.id, makeCtx(tenantId))).rejects.toThrow(
        /indisponível/i,
      );

      const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      expect(sub.planId).toBe(basicoId);
      expect(Number(sub.monthlyAmount)).toBe(29.9);
    } finally {
      await prisma.plan.update({ where: { slug: ADMIN_PLAN_SLUG }, data: { active: false } });
    }
  });

  it("não aparece em listAvailablePlans nem em listPublicPlans, nem ativo", async () => {
    await prisma.plan.update({ where: { slug: ADMIN_PLAN_SLUG }, data: { active: true } });
    try {
      const tenantId = await empresaPagante();
      const ofertados = await PlanoService.listAvailablePlans(tenantId);
      const vitrine = await PlanoService.listPublicPlans();

      const idAdmin = (await prisma.plan.findUniqueOrThrow({ where: { slug: ADMIN_PLAN_SLUG } })).id;
      expect(ofertados.some((p) => p.id === idAdmin)).toBe(false);
      expect(vitrine.some((p) => p.id === idAdmin)).toBe(false);
      // E os planos de verdade continuam lá: o filtro é cirúrgico.
      expect(ofertados.some((p) => p.id === completoId)).toBe(true);
    } finally {
      await prisma.plan.update({ where: { slug: ADMIN_PLAN_SLUG }, data: { active: false } });
    }
  });

  it("o ambiente do super-admin continua funcionando sem ele na lista", async () => {
    // O ambiente interno tem assinatura no plano interno. Tirá-lo da oferta não
    // pode quebrar a tela de plano de quem administra a plataforma.
    const admin = await prisma.user.create({
      data: {
        name: "Operador",
        email: `operador-${uniq()}@teste-ceasapro.com.br`,
        passwordHash: "x",
        role: "SUPER_ADMIN",
      },
    });
    const { tenantId } = await AdminService.getOrCreateAdminWorkspace(makeAdminCtx(admin.id));
    tenants.push(tenantId);

    const view = await PlanoService.getPlanoView(tenantId);
    expect(view?.planName).toBe("Ambiente do administrador");
    const ofertados = await PlanoService.listAvailablePlans(tenantId);
    expect(ofertados.every((p) => p.name !== "Ambiente do administrador")).toBe(true);

    await prisma.user.update({ where: { id: admin.id }, data: { tenantId: null } });
  });
});

describe("Competência já paga: a troca é AGENDADA, não aplicada", () => {
  it("upgrade no mês pago não entrega os módulos novos na hora", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);

    const res = await PlanoService.changePlan(completoId, makeCtx(tenantId));

    expect(res.scheduled).toBe(true);
    expect(res.planName).toBe("Básico Agenda"); // ainda é o plano vigente
    expect(res.monthlyAmount).toBe(29.9);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    // O que fecha a brecha: plano e valor NÃO mudaram dentro do mês pago.
    expect(sub.planId).toBe(basicoId);
    expect(Number(sub.monthlyAmount)).toBe(29.9);
    expect(sub.pendingPlanId).toBe(completoId);
    expect(sub.pendingPlanFrom?.toISOString()).toBe(sub.currentPeriodEnd.toISOString());
    expect(res.effectiveFrom?.toISOString()).toBe(sub.currentPeriodEnd.toISOString());
  });

  it("o token continua sem os módulos do plano caro até a virada", async () => {
    // É aqui que o dinheiro estava vazando de verdade: o claim `modules` é o que
    // libera Cotações, Caixas e Higienização nas próximas horas de uso.
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    const owner = await prisma.user.findFirstOrThrow({ where: { tenantId, role: "OWNER" } });

    await PlanoService.changePlan(completoId, makeCtx(tenantId, owner.id));

    const payload = await buildAccessPayload(owner.id);
    expect(payload?.modules).toEqual([]); // os do Básico
    expect(payload?.modules).not.toContain("cotacoes");
  });

  it("downgrade também espera: o mês pago entrega o que foi vendido", async () => {
    const tenantId = await empresaPagante();
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { planId: completoId, monthlyAmount: 99.9 },
    });
    await pagarCompetencia(tenantId, 99.9);

    const res = await PlanoService.changePlan(basicoId, makeCtx(tenantId));
    expect(res.scheduled).toBe(true);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    // Tirar os módulos agora seria receber o mês cheio e entregar meio.
    expect(sub.planId).toBe(completoId);
    expect(planModules((await prisma.plan.findUniqueOrThrow({ where: { id: sub.planId } })).features))
      .toContain("cotacoes");
    expect(sub.pendingPlanId).toBe(basicoId);
  });

  it("recusa agendar duas vezes o mesmo plano", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    await PlanoService.changePlan(completoId, makeCtx(tenantId));

    await expect(PlanoService.changePlan(completoId, makeCtx(tenantId))).rejects.toThrow(
      /já está agendada/i,
    );
  });

  it("escolher de novo o plano vigente desfaz o agendamento", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    await PlanoService.changePlan(completoId, makeCtx(tenantId));

    const res = await PlanoService.changePlan(basicoId, makeCtx(tenantId));
    expect(res.scheduled).toBe(false);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.pendingPlanId).toBeNull();
    expect(sub.pendingPlanFrom).toBeNull();
    expect(sub.planId).toBe(basicoId);
  });

  it("sem agendamento, escolher o plano vigente continua sendo erro", async () => {
    const tenantId = await empresaPagante();
    await expect(PlanoService.changePlan(basicoId, makeCtx(tenantId))).rejects.toThrow(
      /já é o seu plano/i,
    );
  });
});

describe("Competência em aberto: a troca vale na hora (como sempre valeu)", () => {
  it("empresa que ainda não pagou (trial) troca imediatamente", async () => {
    const tenantId = await empresaPagante({ semPagamento: true });

    const res = await PlanoService.changePlan(completoId, makeCtx(tenantId));

    expect(res.scheduled).toBe(false);
    expect(res.monthlyAmount).toBe(99.9);
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.planId).toBe(completoId);
    expect(sub.pendingPlanId).toBeNull();
  });

  it("competência paga cujo PERÍODO já venceu não segura a troca", async () => {
    // O que protege é o período comprado, não o pagamento em si. Vencido o
    // período, adiar a troca prenderia o cliente ao plano antigo de graça.
    const tenantId = await empresaPagante({ periodEnd: new Date(Date.now() - 60 * 60 * 1000) });
    await pagarCompetencia(tenantId);

    const res = await PlanoService.changePlan(completoId, makeCtx(tenantId));
    expect(res.scheduled).toBe(false);
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.planId).toBe(completoId);
  });

  it("troca imediata para OUTRO plano limpa o agendamento anterior", async () => {
    const outro = await prisma.plan.create({
      data: {
        name: `Intermediário ${uniq()}`,
        slug: `inter-${uniq()}`,
        priceMonthly: 59.9,
        active: true,
        features: { modules: ["caixas"] },
      },
    });
    planIds.push(outro.id);

    const tenantId = await empresaPagante({ semPagamento: true });
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { pendingPlanId: completoId, pendingPlanFrom: new Date(Date.now() + 86_400_000) },
    });

    await PlanoService.changePlan(outro.id, makeCtx(tenantId));
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.planId).toBe(outro.id);
    // Deixar o agendamento de pé trocaria o plano de novo sozinho, dias depois.
    expect(sub.pendingPlanId).toBeNull();
  });

  it("pedir o plano JÁ agendado com a competência aberta aplica na hora", async () => {
    // Recusar aqui prenderia o cliente esperando o cron por nada: o mês novo
    // está em aberto, então não há período pago a proteger.
    const tenantId = await empresaPagante({ semPagamento: true });
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { pendingPlanId: completoId, pendingPlanFrom: new Date(Date.now() + 86_400_000) },
    });

    const res = await PlanoService.changePlan(completoId, makeCtx(tenantId));
    expect(res.scheduled).toBe(false);
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.planId).toBe(completoId);
    expect(sub.pendingPlanId).toBeNull();
  });
});

describe("O período pago protege, não o mês do calendário", () => {
  it("período pago correndo agenda a troca mesmo sem pagamento na competência corrente", async () => {
    // A brecha: pagar o básico em 31/08 (período até 30/09) e subir em 01/09,
    // quando setembro ainda não tem pagamento. Olhando só a competência, valia
    // na hora e o mês inteiro do completo saía pelo preço do básico.
    const tenantId = await empresaPagante();

    const res = await PlanoService.changePlan(completoId, makeCtx(tenantId));
    expect(res.scheduled).toBe(true);
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.planId).toBe(basicoId);
    expect(sub.pendingPlanId).toBe(completoId);
  });

  it("a cobrança do período seguinte sai pelo preço do plano AGENDADO", async () => {
    // Sem isto, pagar a renovação antes da virada comprava o mês do plano novo
    // pelo preço do antigo: o agendamento só adiava o desconto.
    const tenantId = await empresaPagante();
    await PlanoService.changePlan(completoId, makeCtx(tenantId));
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { tenantId },
      include: { pendingPlan: true },
    });
    expect(valorDevido(sub, new Date()).toString()).toBe("99.9");
  });
});

describe("A virada da competência", () => {
  it("o cron aplica a troca quando a data chega", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    await PlanoService.changePlan(completoId, makeCtx(tenantId));

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    const depoisDaVirada = new Date(sub.currentPeriodEnd.getTime() + 60_000);
    await BillingService.recomputeStatuses(depoisDaVirada);

    const virou = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(virou.planId).toBe(completoId);
    expect(Number(virou.monthlyAmount)).toBe(99.9);
    expect(virou.pendingPlanId).toBeNull();
    expect(virou.pendingPlanFrom).toBeNull();
  });

  it("antes da data, o cron não antecipa nada", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    await PlanoService.changePlan(completoId, makeCtx(tenantId));

    await BillingService.recomputeStatuses(new Date());

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.planId).toBe(basicoId);
    expect(sub.pendingPlanId).toBe(completoId);
  });

  it("aplicar é idempotente: rodar duas vezes não troca duas vezes", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    await PlanoService.changePlan(completoId, makeCtx(tenantId));

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    const depois = new Date(sub.currentPeriodEnd.getTime() + 60_000);

    expect(await PlanoService.aplicarTrocaProgramada(sub, depois)).not.toBeNull();
    const jaAplicada = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(await PlanoService.aplicarTrocaProgramada(jaAplicada, depois)).toBeNull();

    const trocas = await prisma.auditLog.count({
      where: { tenantId, entity: "TenantSubscription", action: "UPDATE" },
    });
    // Uma para o agendamento, uma para a aplicação. Nunca três.
    expect(trocas).toBe(2);
  });

  it("plano que saiu de oferta antes da virada descarta o agendamento", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    const temporario = await prisma.plan.create({
      data: {
        name: "Plano Temporário",
        slug: `temp-${uniq()}`,
        priceMonthly: 149.9,
        active: true,
        features: { modules: ["caixas"] },
      },
    });
    planIds.push(temporario.id);
    await PlanoService.changePlan(temporario.id, makeCtx(tenantId));
    await prisma.plan.update({ where: { id: temporario.id }, data: { active: false } });

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    const depois = new Date(sub.currentPeriodEnd.getTime() + 60_000);
    expect(await PlanoService.aplicarTrocaProgramada(sub, depois)).toBeNull();

    const final = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    // Fica no plano que vinha usando e pagando — nunca preso a um plano morto.
    expect(final.planId).toBe(basicoId);
    expect(final.pendingPlanId).toBeNull();
  });

  it("cancelar a assinatura desfaz o agendamento", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    await PlanoService.changePlan(completoId, makeCtx(tenantId));

    await BillingService.cancelarAssinatura(makeCtx(tenantId));

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.cancelledAt).not.toBeNull();
    expect(sub.pendingPlanId).toBeNull();
  });

  it("o cliente pode desfazer o agendamento pela tela", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    await PlanoService.changePlan(completoId, makeCtx(tenantId));

    await PlanoService.cancelarTrocaProgramada(makeCtx(tenantId));
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.pendingPlanId).toBeNull();

    await expect(PlanoService.cancelarTrocaProgramada(makeCtx(tenantId))).rejects.toThrow(
      /não há troca/i,
    );
  });

  it("a tela de plano mostra o agendamento sem mentir sobre o plano vigente", async () => {
    const tenantId = await empresaPagante();
    await pagarCompetencia(tenantId);
    await PlanoService.changePlan(completoId, makeCtx(tenantId));

    const view = await PlanoService.getPlanoView(tenantId);
    expect(view?.planName).toBe("Básico Agenda");
    expect(view?.pendingPlan?.name).toBe("Completo Agenda");
    expect(view?.pendingPlan?.priceMonthly).toBe(99.9);
    // Os módulos listados são os que valem HOJE, não os do plano agendado.
    expect(view?.modules.filter((m) => m.enabled)).toHaveLength(0);
  });
});

describe("Módulos de plano são obrigatórios no painel do admin", () => {
  it("createPlan recusa plano sem a lista de módulos", async () => {
    // `planModules` é fail-closed: plano gravado sem `features.modules` deixa de
    // liberar os opcionais. Sem esta exigência, um plano salvo por um caminho
    // descuidado entregaria menos do que foi vendido — em silêncio.
    const semModulos = { name: `Plano Sem Modulos ${uniq()}`, priceMonthly: 10, active: true };
    await expect(
      AdminService.createPlan(semModulos as unknown as PlanoInput, makeAdminCtx()),
    ).rejects.toThrow(ValidationError);
  });

  it("lista vazia é uma decisão legítima — só o núcleo", async () => {
    const plano = await AdminService.createPlan(
      { name: `Plano Nucleo ${uniq()}`, priceMonthly: 10, active: true, modules: [] },
      makeAdminCtx(),
    );
    planIds.push(plano.id);
    expect(plano.features).toEqual({ modules: [] });
    expect(planModules(plano.features)).toEqual([]);
  });

  it("módulo fora do catálogo é recusado", async () => {
    await expect(
      AdminService.createPlan(
        {
          name: `Plano Invalido ${uniq()}`,
          priceMonthly: 10,
          active: true,
          modules: ["modulo-que-nao-existe"],
        } as unknown as PlanoInput,
        makeAdminCtx(),
      ),
    ).rejects.toThrow(ValidationError);
  });
});
