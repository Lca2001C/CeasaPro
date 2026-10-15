import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants, makeCtx, makeAdminCtx } from "../helpers/factory";
import { refMonthTz } from "@/lib/tz";
import type { OptionalModuleKey } from "@/lib/plan/modules";
import type { MpPayment } from "@/lib/payments/mercadopago";

/**
 * O mês pago entrega os módulos e o preço que valiam quando aquele período foi
 * contratado. Editar o catálogo (preço ou módulos) ou desativar o plano não muda
 * o que já foi pago nem o que já foi agendado; contratação e agendamento NOVOS
 * leem o catálogo vivo.
 *
 * As brechas que isto fecha:
 *  1. o admin tirava um módulo do plano e quem já tinha pago o mês o perdia no
 *     refresh seguinte do token (`plan.features` era lido ao vivo);
 *  2. reajustar o plano ALVO de uma troca agendada mudava o que a renovação
 *     cobrava e entregava — o QR já emitido virava "valor a menor";
 *  3. desativar plano e agendar troca para ele cabiam no mesmo instante, e a
 *     conferência do valor do pagamento rodava fora da transação que aprova.
 */

const gw = vi.hoisted(() => ({ chamadas: 0, cancelados: [] as string[] }));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    createPixPayment: vi.fn(async (args: { expiresAt: Date }) => {
      gw.chamadas += 1;
      const id = `mp-cong-${gw.chamadas}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        mpPaymentId: id,
        status: "pending",
        qrCode: `QR-${id}`,
        qrCodeBase64: "aW1n",
        ticketUrl: null,
        expiresAt: args.expiresAt,
      };
    }),
    cancelPayment: vi.fn(async (id: string) => {
      gw.cancelados.push(id);
      return { id, status: "cancelled" };
    }),
  };
});

import { BillingService, valorDevido } from "@/lib/services/billing.service";
import { PlanoService } from "@/lib/services/plano.service";
import { AdminService } from "@/lib/services/admin.service";
import { buildAccessPayload } from "@/lib/auth/build-session";

const uniq = () => Math.random().toString(36).slice(2, 8);
const DIA = 24 * 60 * 60 * 1000;
const daquiA = (dias: number) => new Date(Date.now() + dias * DIA);
const tenants: string[] = [];
const planIds: string[] = [];

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
});

async function plano(priceMonthly: number, modules: OptionalModuleKey[]) {
  const p = await prisma.plan.create({
    data: {
      name: `Plano ${uniq()}`,
      slug: `cong-${uniq()}-${uniq()}`,
      priceMonthly,
      active: true,
      features: { modules },
    },
  });
  planIds.push(p.id);
  return p;
}

/** O que o painel do admin manda ao salvar o plano. */
function editar(
  p: { id: string; name: string; priceMonthly: unknown; active: boolean },
  mudanca: { priceMonthly?: number; active?: boolean; modules: OptionalModuleKey[] },
) {
  return AdminService.updatePlan(
    {
      id: p.id,
      name: p.name,
      priceMonthly: mudanca.priceMonthly ?? Number(p.priceMonthly),
      active: mudanca.active ?? p.active,
      modules: mudanca.modules,
    },
    makeAdminCtx(),
  );
}

/**
 * Empresa com dono. `pago`: período pago correndo (ativada há 10 dias, vence em
 * `venceEm` dias), com o pagamento APROVADO da competência gravado do jeito de
 * antes desta mudança — sem `features`. `trial`: nunca pagou.
 * `vencida`: nunca pagou e o período já passou (a troca vale na hora).
 */
async function empresa(
  planId: string,
  monthlyAmount: number,
  modo: "pago" | "trial" | "vencida",
  venceEm = 20,
) {
  const tenantId = await createTestTenant("PLANO CONGELADO");
  tenants.push(tenantId);
  const currentPeriodEnd =
    modo === "vencida" ? new Date(Date.now() - DIA) : daquiA(modo === "trial" ? 5 : venceEm);
  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: modo === "pago" ? "ATIVO" : modo === "trial" ? "TRIAL" : "SUSPENSO",
      monthlyAmount,
      activatedAt: modo === "pago" ? daquiA(-10) : null,
      trialEndsAt: modo === "trial" ? daquiA(5) : null,
      currentPeriodEnd,
      graceDays: 5,
    },
  });
  const owner = await prisma.user.create({
    data: {
      tenantId,
      name: "Dono",
      email: `cong-${uniq()}@teste-ceasapro.com.br`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  if (modo === "pago") {
    const referenceMonth = refMonthTz(new Date());
    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        tenantId,
        amount: monthlyAmount,
        status: "APROVADO",
        method: "PIX",
        referenceMonth,
        mpPaymentId: `cong-pago-${uniq()}`,
        approvedKey: `${tenantId}:${referenceMonth}`,
        paidAt: daquiA(-10),
        periodStart: daquiA(-10),
        periodEnd: currentPeriodEnd,
      },
    });
  }
  return { tenantId, subId: sub.id, ownerId: owner.id, ctx: makeCtx(tenantId, owner.id) };
}

/** Cobrança PIX em aberto, direto no banco. */
async function qrPendente(
  e: { tenantId: string; subId: string },
  amount: number,
  referenceMonth = refMonthTz(new Date()),
) {
  return prisma.subscriptionPayment.create({
    data: {
      subscriptionId: e.subId,
      tenantId: e.tenantId,
      amount,
      status: "PENDENTE",
      method: "PIX",
      referenceMonth,
      mpPaymentId: `cong-qr-${uniq()}-${uniq()}`,
      expiresAt: daquiA(1),
    },
  });
}

/** O pagamento como o Mercado Pago o devolve. */
function mp(id: string, amount: number, status = "approved"): MpPayment {
  return {
    id,
    status,
    statusDetail: status === "approved" ? "accredited" : status,
    externalReference: null,
    amount,
    method: "pix",
    paymentTypeId: "bank_transfer",
    paidAt: status === "approved" ? new Date() : null,
  } as MpPayment;
}

async function modulosDaTela(tenantId: string, now?: Date) {
  const view = await PlanoService.getPlanoView(tenantId, now);
  return view!.modules.filter((m) => m.enabled).map((m) => m.key);
}

const sub = (tenantId: string) =>
  prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId }, include: { pendingPlan: true } });

describe("Edição do plano não atravessa o período já pago", () => {
  it("mês pago, admin tira um módulo: token e tela seguem com ele até o vencimento; depois, sem ele", async () => {
    const p = await plano(79.9, ["caixas", "cotacoes"]);
    const e = await empresa(p.id, 79.9, "pago");

    await editar(p, { modules: ["caixas"] });

    // O catálogo mudou — é ele que contratação nova lê.
    const vivo = await prisma.plan.findUniqueOrThrow({ where: { id: p.id } });
    expect(vivo.features).toEqual({ modules: ["caixas"] });

    // Quem já pagou o mês continua com o que pagou.
    const congelada = await sub(e.tenantId);
    expect(congelada.heldFeatures).toEqual({ modules: ["caixas", "cotacoes"] });
    expect(congelada.heldFeaturesUntil?.toISOString()).toBe(congelada.currentPeriodEnd.toISOString());
    expect((await buildAccessPayload(e.ownerId))?.modules).toContain("cotacoes");
    expect(await modulosDaTela(e.tenantId)).toContain("cotacoes");

    // Passado o vencimento, o congelamento não vale mais — nada de módulo de graça.
    const depois = new Date(congelada.currentPeriodEnd.getTime() + 60_000);
    expect(await modulosDaTela(e.tenantId, depois)).toEqual(["caixas"]);

    // O mesmo no token: o período venceu.
    await prisma.tenantSubscription.update({
      where: { tenantId: e.tenantId },
      data: { currentPeriodEnd: new Date(Date.now() - 1000), heldFeaturesUntil: new Date(Date.now() - 1000) },
    });
    const vencido = await buildAccessPayload(e.ownerId);
    expect(vencido?.modules).not.toContain("cotacoes");
    expect(vencido?.modules).toContain("caixas");
  });

  it("a segunda edição no mesmo período não estende nem sobrescreve o congelamento", async () => {
    const p = await plano(79.9, ["caixas", "cotacoes"]);
    const e = await empresa(p.id, 79.9, "pago");

    await editar(p, { modules: ["caixas"] });
    const primeiro = await sub(e.tenantId);
    await editar({ ...p, priceMonthly: 79.9 }, { modules: [] });

    const segundo = await sub(e.tenantId);
    expect(segundo.heldFeatures).toEqual({ modules: ["caixas", "cotacoes"] });
    expect(segundo.heldFeaturesUntil?.toISOString()).toBe(primeiro.heldFeaturesUntil?.toISOString());
  });

  it("o pagamento aprovado grava os módulos que comprou, e a edição respeita isso sem congelar", async () => {
    const p = await plano(79.9, ["caixas", "cotacoes"]);
    const e = await empresa(p.id, 79.9, "vencida");
    const qr = await qrPendente(e, 79.9);

    expect(await BillingService.applyPaymentStatus(mp(qr.mpPaymentId!, 79.9))).toBe("aplicado");
    const pago = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: qr.id } });
    expect(pago.status).toBe("APROVADO");
    expect(pago.features).toEqual({ modules: ["caixas", "cotacoes"] });

    await editar(p, { modules: ["caixas"] });

    // Quem responde pelo mês é o pagamento: não há o que congelar.
    expect((await sub(e.tenantId)).heldFeatures).toBeNull();
    expect((await buildAccessPayload(e.ownerId))?.modules).toContain("cotacoes");
    expect(await modulosDaTela(e.tenantId)).toContain("cotacoes");
    const fim = new Date(pago.periodEnd!.getTime() + 60_000);
    expect(await modulosDaTela(e.tenantId, fim)).toEqual(["caixas"]);
  });

  it("trial não ganha congelamento: segue o catálogo vivo", async () => {
    const p = await plano(79.9, ["caixas", "cotacoes"]);
    const e = await empresa(p.id, 79.9, "trial");

    await editar(p, { modules: ["caixas"] });

    const s = await sub(e.tenantId);
    expect(s.heldFeatures).toBeNull();
    expect(s.heldFeaturesUntil).toBeNull();
    expect((await buildAccessPayload(e.ownerId))?.modules).toEqual(["caixas"]);
  });

  it("período vencido não ganha congelamento", async () => {
    const p = await plano(79.9, ["caixas", "cotacoes"]);
    const e = await empresa(p.id, 79.9, "pago");
    await prisma.tenantSubscription.update({
      where: { tenantId: e.tenantId },
      data: { currentPeriodEnd: new Date(Date.now() - DIA) },
    });

    await editar(p, { modules: ["caixas"] });
    expect((await sub(e.tenantId)).heldFeatures).toBeNull();
  });
});

describe("Reajuste do catálogo não é aumento de mensalidade", () => {
  it("admin muda o preço do plano vigente: monthlyAmount de quem já assinou permanece", async () => {
    const p = await plano(29.9, []);
    const pagante = await empresa(p.id, 29.9, "pago");
    const trial = await empresa(p.id, 29.9, "trial");

    await editar(p, { priceMonthly: 39.9, modules: [] });

    for (const e of [pagante, trial]) {
      const s = await sub(e.tenantId);
      expect(Number(s.monthlyAmount)).toBe(29.9);
      expect(valorDevido(s, new Date()).toString()).toBe("29.9");
    }
    // Só o preço mudou: não há módulo a congelar.
    expect((await sub(pagante.tenantId)).heldFeatures).toBeNull();
  });

  it("contratação nova depois do reajuste lê o catálogo vivo", async () => {
    const barato = await plano(19.9, []);
    const alvo = await plano(49.9, ["caixas"]);
    await editar(alvo, { priceMonthly: 59.9, modules: ["caixas"] });

    const e = await empresa(barato.id, 19.9, "vencida");
    const res = await PlanoService.changePlan(alvo.id, e.ctx);
    expect(res.scheduled).toBe(false);
    expect(res.monthlyAmount).toBe(59.9);
  });
});

describe("A troca agendada vale pelo preço e pelos módulos da hora do agendamento", () => {
  it("admin sobe o preço do plano alvo: a cobrança segue no preço gravado, o QR antigo credita e a virada usa o snapshot", async () => {
    const basico = await plano(29.9, []);
    const completo = await plano(99.9, ["caixas", "cotacoes"]);
    // Vence em 2 dias: dentro da janela de renovação, a cobrança já é do período seguinte.
    const e = await empresa(basico.id, 29.9, "pago", 2);

    const troca = await PlanoService.changePlan(completo.id, e.ctx);
    expect(troca.scheduled).toBe(true);
    const agendada = await sub(e.tenantId);
    expect(Number(agendada.pendingPriceMonthly)).toBe(99.9);
    expect(agendada.pendingFeatures).toEqual({ modules: ["caixas", "cotacoes"] });

    const qr = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    expect(Number(qr.amount)).toBe(99.9);

    // O catálogo muda depois do agendamento: preço sobe e um módulo sai.
    await editar(completo, { priceMonthly: 149.9, modules: ["caixas"] });

    const depoisDoReajuste = await sub(e.tenantId);
    expect(valorDevido(depoisDoReajuste, new Date()).toString()).toBe("99.9");
    // O QR em aberto continua sendo a cobrança certa — não é trocado.
    const deNovo = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    expect(deNovo.id).toBe(qr.id);
    expect(Number(deNovo.amount)).toBe(99.9);
    // A tela anuncia o preço contratado, não o do catálogo de hoje.
    expect((await PlanoService.getPlanoView(e.tenantId))?.pendingPlan?.priceMonthly).toBe(99.9);

    // Pago o QR antigo, o período seguinte é creditado com os módulos do agendamento.
    expect(await BillingService.applyPaymentStatus(mp(qr.mpPaymentId!, 99.9))).toBe("aplicado");
    const pago = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: qr.id } });
    expect(pago.status).toBe("APROVADO");
    expect(pago.uncreditedReason).toBeNull();
    expect(pago.periodStart?.toISOString()).toBe(agendada.currentPeriodEnd.toISOString());
    expect(pago.features).toEqual({ modules: ["caixas", "cotacoes"] });

    // A virada: mensalidade do agendamento, nunca o preço reajustado.
    const virada = new Date(agendada.currentPeriodEnd.getTime() + 60_000);
    expect(await modulosDaTela(e.tenantId, virada)).toEqual(["caixas", "cotacoes"]);
    const final = await sub(e.tenantId);
    expect(final.planId).toBe(completo.id);
    expect(Number(final.monthlyAmount)).toBe(99.9);
    expect(final.pendingPlanId).toBeNull();
    expect(final.pendingPriceMonthly).toBeNull();
    expect(final.pendingFeatures).toBeNull();
    // A renovação já paga esticou o período para além da virada: congelado no snapshot.
    expect(final.heldFeatures).toEqual({ modules: ["caixas", "cotacoes"] });
    expect(final.heldFeaturesUntil?.toISOString()).toBe(final.currentPeriodEnd.toISOString());
  });

  it("virada com o período vencido não entrega módulo a mais: fica no catálogo vivo", async () => {
    const basico = await plano(29.9, []);
    const completo = await plano(99.9, ["caixas", "cotacoes"]);
    const e = await empresa(basico.id, 29.9, "pago");
    await PlanoService.changePlan(completo.id, e.ctx);
    await editar(completo, { priceMonthly: 149.9, modules: ["caixas"] });

    const agendada = await sub(e.tenantId);
    const virada = new Date(agendada.currentPeriodEnd.getTime() + 60_000);
    await PlanoService.aplicarTrocaProgramada(agendada, virada);

    const final = await sub(e.tenantId);
    expect(final.planId).toBe(completo.id);
    expect(Number(final.monthlyAmount)).toBe(99.9);
    expect(final.heldFeatures).toBeNull();
    expect(await modulosDaTela(e.tenantId, virada)).toEqual(["caixas"]);
  });
});

describe("Desativar o plano e agendar a troca não passam juntos", () => {
  it("desativar plano com troca agendada é recusado", async () => {
    const basico = await plano(29.9, []);
    const completo = await plano(99.9, ["caixas"]);
    const e = await empresa(basico.id, 29.9, "pago");
    await PlanoService.changePlan(completo.id, e.ctx);

    await expect(editar(completo, { active: false, modules: ["caixas"] })).rejects.toThrow(
      /troca agendada/i,
    );
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: completo.id } })).active).toBe(true);
  });

  it("agendar para plano já inativo é recusado", async () => {
    const basico = await plano(29.9, []);
    const completo = await plano(99.9, ["caixas"]);
    await editar(completo, { active: false, modules: ["caixas"] });
    const e = await empresa(basico.id, 29.9, "pago");

    await expect(PlanoService.changePlan(completo.id, e.ctx)).rejects.toThrow(/indisponível/i);
    expect((await sub(e.tenantId)).pendingPlanId).toBeNull();
  });

  it("a troca que chega durante a desativação espera o commit e é recusada", async () => {
    const basico = await plano(29.9, []);
    const completo = await plano(99.9, ["caixas"]);
    const e = await empresa(basico.id, 29.9, "pago");

    // A desativação segura a linha do plano (como `updatePlan`) enquanto a
    // troca chega. Sem a trava compartilhada na troca, ela leria `active: true`
    // e gravaria o agendamento por baixo da desativação.
    let travou!: () => void;
    const travado = new Promise<void>((r) => (travou = r));
    const desativacao = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM plans WHERE id = ${completo.id} FOR UPDATE`;
        await tx.plan.update({ where: { id: completo.id }, data: { active: false } });
        travou();
        await new Promise((r) => setTimeout(r, 400));
      },
      { timeout: 10_000 },
    );
    await travado;
    const troca = PlanoService.changePlan(completo.id, e.ctx).then(
      () => null,
      (err: unknown) => err,
    );
    await desativacao;

    expect(String(await troca)).toMatch(/indisponível/i);
    expect((await sub(e.tenantId)).pendingPlanId).toBeNull();
  });
});

describe("A aprovação confere o valor com a assinatura travada", () => {
  it("valor menor que o devido depois de um upgrade já commitado: não credita e não ativa o plano caro", async () => {
    const basico = await plano(29.9, []);
    const completo = await plano(99.9, ["caixas", "cotacoes"]);
    const e = await empresa(basico.id, 29.9, "vencida");
    const qr = await qrPendente(e, 29.9);
    const antes = await sub(e.tenantId);

    // Período em aberto: a troca vale na hora e o QR do básico é baixado.
    const res = await PlanoService.changePlan(completo.id, e.ctx);
    expect(res.scheduled).toBe(false);
    expect((await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: qr.id } })).status).toBe(
      "CANCELADO",
    );

    // O Mercado Pago confirma o QR antigo mesmo assim.
    expect(await BillingService.applyPaymentStatus(mp(qr.mpPaymentId!, 29.9))).toBe("ignorado");

    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: qr.id } });
    expect(linha.status).not.toBe("APROVADO");
    expect(linha.approvedKey).toBeNull();
    expect(linha.uncreditedReason).toBe("VALOR_MENOR");
    const depois = await sub(e.tenantId);
    expect(depois.currentPeriodEnd.toISOString()).toBe(antes.currentPeriodEnd.toISOString());
    expect(depois.activatedAt).toBeNull();
    expect(depois.status).not.toBe("ATIVO");
  });

  it("upgrade que commita no meio da aprovação: a aprovação espera, relê e não credita o valor menor", async () => {
    const basico = await plano(29.9, []);
    const completo = await plano(99.9, ["caixas", "cotacoes"]);
    const e = await empresa(basico.id, 29.9, "vencida");
    const qr = await qrPendente(e, 29.9);
    const antes = await sub(e.tenantId);

    // A troca segura a linha da assinatura (como `changePlan`) e só grava o
    // plano caro depois que a aprovação já começou. Com a conferência fora da
    // transação, o webhook lia 29,90, a troca commitava, e o mês era creditado
    // no plano de 99,90.
    let travou!: () => void;
    const travado = new Promise<void>((r) => (travou = r));
    const upgrade = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenant_subscriptions WHERE id = ${e.subId} FOR UPDATE`;
        travou();
        await new Promise((r) => setTimeout(r, 400));
        await tx.tenantSubscription.update({
          where: { id: e.subId },
          data: { planId: completo.id, monthlyAmount: 99.9 },
        });
      },
      { timeout: 10_000 },
    );
    await travado;
    const aprovacao = BillingService.applyPaymentStatus(mp(qr.mpPaymentId!, 29.9));
    await upgrade;

    expect(await aprovacao).toBe("ignorado");
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: qr.id } });
    expect(linha.status).not.toBe("APROVADO");
    expect(linha.uncreditedReason).toBe("VALOR_MENOR");
    const depois = await sub(e.tenantId);
    expect(depois.planId).toBe(completo.id);
    expect(depois.currentPeriodEnd.toISOString()).toBe(antes.currentPeriodEnd.toISOString());
    expect(depois.status).not.toBe("ATIVO");
  });

  it("uma aprovação por competência continua valendo", async () => {
    const p = await plano(29.9, []);
    const e = await empresa(p.id, 29.9, "vencida");
    const primeiro = await qrPendente(e, 29.9);
    const segundo = await qrPendente(e, 29.9);

    expect(await BillingService.applyPaymentStatus(mp(primeiro.mpPaymentId!, 29.9))).toBe("aplicado");
    const creditado = await sub(e.tenantId);

    expect(await BillingService.applyPaymentStatus(mp(segundo.mpPaymentId!, 29.9))).toBe("ignorado");
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: segundo.id } });
    expect(linha.status).not.toBe("APROVADO");
    expect(linha.uncreditedReason).toBe("DUPLICADO");
    expect((await sub(e.tenantId)).currentPeriodEnd.toISOString()).toBe(
      creditado.currentPeriodEnd.toISOString(),
    );
    expect(
      await prisma.subscriptionPayment.count({
        where: { tenantId: e.tenantId, status: "APROVADO" },
      }),
    ).toBe(1);
  });
});
