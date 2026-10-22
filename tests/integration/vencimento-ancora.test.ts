import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import { civilParts } from "@/lib/tz";

/**
 * O vencimento renovado pela aprovação do pagamento mantém o dia âncora.
 *
 * Antes, `periodEnd = addOneMonth(periodStart)` com `periodStart` = vencimento
 * atual: uma vez em 28/02, a assinatura do dia 31 vencia no 28 para sempre.
 */

const gw = vi.hoisted(() => ({ status: new Map<string, string>() }));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    cancelPayment: vi.fn(async () => {}),
    getPayment: vi.fn(async (id: string) => {
      const status = gw.status.get(id);
      if (!status) throw new Error(`pagamento fora deste teste: ${id}`);
      return {
        id,
        status,
        statusDetail: status === "approved" ? "accredited" : status,
        externalReference: null,
        amount: 49.9,
        method: "pix",
        paymentTypeId: "bank_transfer",
        paidAt: status === "approved" ? new Date() : null,
      };
    }),
  };
});

import { BillingService } from "@/lib/services/billing.service";
import { computeStatus } from "@/lib/billing/status";

const uniq = () => Math.random().toString(36).slice(2, 8);
const brt = (iso: string) => new Date(`${iso}T10:00:00-03:00`);
const dia = (d: Date) => {
  const c = civilParts(d);
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
};
const tenants: string[] = [];
let planId = "";

beforeAll(async () => {
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Âncora",
      slug: `ancora-${Date.now()}`,
      priceMonthly: 49.9,
      active: true,
      features: { modules: [] },
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
});

/** Assinatura já ativa, com o vencimento (futuro) dado. */
async function assinatura(currentPeriodEnd: Date, extra: { diaAncora?: number | null } = {}) {
  const tenantId = await createTestTenant("VENCIMENTO ANCORA");
  tenants.push(tenantId);
  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: "ATIVO",
      monthlyAmount: 49.9,
      activatedAt: new Date(),
      currentPeriodEnd,
      graceDays: 5,
      ...extra,
    },
  });
  return { tenantId, subId: sub.id };
}

/** Uma cobrança da competência dada, aprovada pelo webhook. */
async function pagar(ctx: { tenantId: string; subId: string }, referenceMonth: string) {
  const mpPaymentId = `mp-ancora-${uniq()}`;
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: ctx.subId,
      tenantId: ctx.tenantId,
      amount: 49.9,
      status: "PENDENTE",
      method: "PIX",
      referenceMonth,
      mpPaymentId,
    },
  });
  gw.status.set(mpPaymentId, "approved");
  const r = await BillingService.handleWebhook(mpPaymentId);
  return { mpPaymentId, r };
}

const sub = (id: string) => prisma.tenantSubscription.findUniqueOrThrow({ where: { id } });

describe("renovações consecutivas pela âncora", () => {
  it("31/01 → 28/02 → 31/03 → 30/04 → 31/05, gravando a âncora 31", async () => {
    const ctx = await assinatura(brt("2027-01-31"));
    const vencimentos: string[] = [];
    for (const comp of ["2027-02", "2027-03", "2027-04", "2027-05"]) {
      const { r } = await pagar(ctx, comp);
      expect(r).toBe("aplicado");
      vencimentos.push(dia((await sub(ctx.subId)).currentPeriodEnd));
    }
    expect(vencimentos).toEqual(["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
    expect((await sub(ctx.subId)).diaAncora).toBe(31);
  });

  it("a âncora gravada vence o dia do vencimento atual", async () => {
    // Vencimento em 28/02 com âncora 30 já gravada: o próximo é 30/03.
    const ctx = await assinatura(brt("2027-02-28"), { diaAncora: 30 });
    await pagar(ctx, "2027-03");
    expect(dia((await sub(ctx.subId)).currentPeriodEnd)).toBe("2027-03-30");
  });
});

describe("assinatura anterior à coluna (diaAncora nulo)", () => {
  async function comHistorico(semPeriodo = false) {
    // Deslizou: começou em 31/01, renovou em 28/02 e caiu no 28/03.
    const ctx = await assinatura(brt("2027-03-28"));
    const linhas = [
      { comp: "2027-01", ini: brt("2027-01-31"), fim: brt("2027-02-28") },
      { comp: "2027-02", ini: brt("2027-02-28"), fim: brt("2027-03-28") },
    ];
    for (const [i, l] of linhas.entries()) {
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: ctx.subId,
          tenantId: ctx.tenantId,
          amount: 49.9,
          status: "APROVADO",
          method: "PIX",
          referenceMonth: l.comp,
          mpPaymentId: `mp-hist-${uniq()}`,
          approvedKey: `${ctx.tenantId}:${l.comp}`,
          periodStart: semPeriodo && i === 0 ? null : l.ini,
          periodEnd: semPeriodo && i === 0 ? null : l.fim,
        },
      });
    }
    return ctx;
  }

  it("com histórico contínuo, recupera a âncora 31: 28/03 → 30/04", async () => {
    const ctx = await comHistorico();
    await pagar(ctx, "2027-03");
    const s = await sub(ctx.subId);
    expect(dia(s.currentPeriodEnd)).toBe("2027-04-30");
    expect(s.diaAncora).toBe(31);
  });

  it("com histórico inconclusivo, fica no dia do vencimento atual (o de antes)", async () => {
    const ctx = await comHistorico(true);
    await pagar(ctx, "2027-03");
    const s = await sub(ctx.subId);
    expect(dia(s.currentPeriodEnd)).toBe("2027-04-28");
    expect(s.diaAncora).toBe(28);
  });

  it("sem histórico, a âncora é o dia do vencimento atual", async () => {
    const ctx = await assinatura(brt("2027-06-15"));
    await pagar(ctx, "2027-07");
    const s = await sub(ctx.subId);
    expect(dia(s.currentPeriodEnd)).toBe("2027-07-15");
    expect(s.diaAncora).toBe(15);
  });
});

describe("recomeço depois de ficar sem acesso", () => {
  it("o período começa no dia do pagamento, que vira a nova âncora", async () => {
    const vencidoHaMuito = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    const ctx = await assinatura(vencidoHaMuito, { diaAncora: 31 });
    await prisma.tenantSubscription.update({ where: { id: ctx.subId }, data: { status: "SUSPENSO" } });
    const hoje = civilParts(new Date()).day;
    const comp = `${civilParts(new Date()).year}-${String(civilParts(new Date()).month).padStart(2, "0")}`;
    await pagar(ctx, comp);
    const s = await sub(ctx.subId);
    expect(s.diaAncora).toBe(hoje);
    expect(s.status).toBe("ATIVO");
  });
});

describe("competência e idempotência continuam iguais", () => {
  it("o mesmo webhook duas vezes não anda o vencimento duas vezes", async () => {
    const ctx = await assinatura(brt("2027-08-31"));
    const { mpPaymentId } = await pagar(ctx, "2027-09");
    const depois = await sub(ctx.subId);
    expect(await BillingService.handleWebhook(mpPaymentId)).toBe("ignorado");
    expect((await sub(ctx.subId)).currentPeriodEnd.toISOString()).toBe(
      depois.currentPeriodEnd.toISOString(),
    );
    expect(dia(depois.currentPeriodEnd)).toBe("2027-09-30");
  });

  it("segundo pagamento da MESMA competência não credita de novo", async () => {
    const ctx = await assinatura(brt("2027-10-31"));
    await pagar(ctx, "2027-11");
    const venc = (await sub(ctx.subId)).currentPeriodEnd.toISOString();
    const { mpPaymentId, r } = await pagar(ctx, "2027-11");
    expect(r).toBe("ignorado");
    expect((await sub(ctx.subId)).currentPeriodEnd.toISOString()).toBe(venc);
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { mpPaymentId } });
    expect(linha.uncreditedReason).toBe("DUPLICADO");
  });

  it("o pagamento grava o período comprado, e o status segue o cálculo de sempre", async () => {
    const ctx = await assinatura(brt("2027-12-31"));
    const { mpPaymentId } = await pagar(ctx, "2028-01");
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { mpPaymentId } });
    expect(dia(linha.periodStart!)).toBe("2027-12-31");
    expect(dia(linha.periodEnd!)).toBe("2028-01-31");
    expect(linha.approvedKey).toBe(`${ctx.tenantId}:2028-01`);
    const s = await sub(ctx.subId);
    expect(computeStatus(s, new Date())).toBe("ATIVO");
  });
});

describe("estorno de um mês do meio recua um mês na âncora", () => {
  it("31/01 pago até 28/02 e 31/03: estornar o primeiro volta o vencimento a 28/02", async () => {
    const ctx = await assinatura(brt("2027-01-31"));
    const { mpPaymentId: primeiro } = await pagar(ctx, "2027-02");
    await pagar(ctx, "2027-03");
    expect(dia((await sub(ctx.subId)).currentPeriodEnd)).toBe("2027-03-31");

    gw.status.set(primeiro, "refunded");
    await BillingService.handleWebhook(primeiro);
    // Era 31/03 − 28 dias = 03/03.
    expect(dia((await sub(ctx.subId)).currentPeriodEnd)).toBe("2027-02-28");
  });
});

describe("vencimento corrigido à mão no banco", () => {
  it("fora da âncora gravada, o dia do vencimento manda", async () => {
    // Âncora 10, mas o suporte moveu o vencimento para 24/03.
    const ctx = await assinatura(brt("2027-03-24"), { diaAncora: 10 });
    await pagar(ctx, "2027-04");
    const s = await sub(ctx.subId);
    expect(dia(s.currentPeriodEnd)).toBe("2027-04-24");
    expect(s.diaAncora).toBe(24);
  });

  it("histórico com elo que não fecha um mês é inconclusivo", async () => {
    const ctx = await assinatura(brt("2027-05-20"));
    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: ctx.subId,
        tenantId: ctx.tenantId,
        amount: 49.9,
        status: "APROVADO",
        method: "PIX",
        referenceMonth: "2027-05",
        mpPaymentId: `mp-elo-${uniq()}`,
        approvedKey: `${ctx.tenantId}:2027-05`,
        // 15 dias, não um mês: período gravado à mão.
        periodStart: brt("2027-05-05"),
        periodEnd: brt("2027-05-20"),
      },
    });
    await pagar(ctx, "2027-06");
    expect(dia((await sub(ctx.subId)).currentPeriodEnd)).toBe("2027-06-20");
  });
});
