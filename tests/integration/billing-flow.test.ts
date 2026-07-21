import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

// ── Mock do gateway Mercado Pago (a integração real é coberta pela sandbox/produção) ──
const gw = vi.hoisted(() => ({
  createCalls: 0,
  cardCalls: 0,
  nextCardStatus: "approved", // status que o próximo createCardPayment devolve
  paymentStatus: new Map<string, string>(), // mpPaymentId -> status no "MP"
}));

vi.mock("@/lib/payments/mercadopago", () => ({
  isMercadoPagoConfigured: () => true,
  PIX_EXPIRATION_HOURS: 24,
  createPixPayment: vi.fn(async () => {
    gw.createCalls += 1;
    const id = `mp-${gw.createCalls}`;
    gw.paymentStatus.set(id, "pending");
    return {
      mpPaymentId: id,
      status: "pending",
      qrCode: `PIXCOPIAECOLA-${id}`,
      qrCodeBase64: "aW1hZ2VtLWZha2U=",
      ticketUrl: `https://mp.fake/${id}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }),
  createCardPayment: vi.fn(async () => {
    gw.cardCalls += 1;
    const id = `mpc-${gw.cardCalls}`;
    gw.paymentStatus.set(id, gw.nextCardStatus);
    return { mpPaymentId: id, status: gw.nextCardStatus };
  }),
  getPayment: vi.fn(async (id: string) => ({
    id,
    status: gw.paymentStatus.get(id) ?? "pending",
    externalReference: null,
    amount: 49.9,
    method: id.startsWith("mpc-") ? "card" : "pix",
  })),
  verifyWebhookSignature: () => true,
}));

import { BillingService } from "@/lib/services/billing.service";

let tenantId = "";
let planId = "";
const periodEndInicial = new Date("2026-08-01T00:00:00Z");
const cardTenants: string[] = [];

// Cria um tenant isolado (com assinatura TRIAL + OWNER) para um cenário de cartão.
async function createCardTenant(): Promise<string> {
  const id = await createTestTenant("BILLING CARD");
  await prisma.tenantSubscription.create({
    data: {
      tenantId: id,
      planId,
      status: "TRIAL",
      monthlyAmount: 49.9,
      currentPeriodEnd: periodEndInicial,
      graceDays: 5,
    },
  });
  await prisma.user.create({
    data: {
      tenantId: id,
      name: "Dono Card",
      email: `card-${id}@teste.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  cardTenants.push(id);
  return id;
}

beforeAll(async () => {
  tenantId = await createTestTenant("BILLING MP");
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Teste Billing",
      slug: `teste-billing-${Date.now()}`,
      priceMonthly: 49.9,
      active: true,
    },
  });
  planId = plan.id;
  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: "TRIAL",
      monthlyAmount: 49.9,
      trialEndsAt: new Date("2026-07-20T00:00:00Z"),
      currentPeriodEnd: periodEndInicial,
      graceDays: 5,
    },
  });
  // O OWNER fornece o e-mail do pagador.
  await prisma.user.create({
    data: {
      tenantId,
      name: "Dono Billing",
      email: `billing-${Date.now()}@teste.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
});

afterAll(async () => {
  await cleanupTenants([tenantId, ...cardTenants]);
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
});

describe("Cobrança mensal PIX (Mercado Pago)", () => {
  it("gera a cobrança do mês com QR Code e validade", async () => {
    const charge = await BillingService.createOrGetMonthlyCharge(tenantId);
    expect(charge.status).toBe("PENDENTE");
    expect(charge.qrCode).toContain("PIXCOPIAECOLA");
    expect(charge.qrCodeBase64).toBeTruthy();
    expect(charge.expiresAt).toBeTruthy();
    expect(gw.createCalls).toBe(1);
  });

  it("é idempotente no mês: segunda chamada devolve a MESMA cobrança sem chamar o MP", async () => {
    const again = await BillingService.createOrGetMonthlyCharge(tenantId);
    expect(gw.createCalls).toBe(1); // não criou outra no MP
    const all = await prisma.subscriptionPayment.count({ where: { tenantId } });
    expect(all).toBe(1);
    expect(again.mpPaymentId).toBe("mp-1");
  });

  it("QR expirado: cancela a cobrança antiga e gera uma nova", async () => {
    await prisma.subscriptionPayment.updateMany({
      where: { tenantId, status: "PENDENTE" },
      data: { expiresAt: new Date(Date.now() - 60_000) }, // força expirar
    });
    const renewed = await BillingService.createOrGetMonthlyCharge(tenantId);
    expect(gw.createCalls).toBe(2);
    expect(renewed.mpPaymentId).toBe("mp-2");

    const old = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId: "mp-1" } });
    expect(old?.status).toBe("CANCELADO");
  });
});

describe("Webhook de pagamento (idempotente, ativa a assinatura)", () => {
  it("pagamento aprovado: marca APROVADO, ativa a assinatura e avança o vencimento 1 mês", async () => {
    gw.paymentStatus.set("mp-2", "approved");
    await BillingService.handleWebhook("mp-2");

    const payment = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId: "mp-2" } });
    expect(payment?.status).toBe("APROVADO");
    expect(payment?.paidAt).toBeTruthy();

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe("ATIVO");
    expect(sub?.trialEndsAt).toBeNull();
    const expected = new Date(periodEndInicial);
    expected.setMonth(expected.getMonth() + 1);
    expect(sub?.currentPeriodEnd.toISOString()).toBe(expected.toISOString());
  });

  it("reentrega do mesmo webhook NÃO avança o vencimento de novo (idempotência)", async () => {
    await BillingService.handleWebhook("mp-2");
    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    const expected = new Date(periodEndInicial);
    expected.setMonth(expected.getMonth() + 1);
    expect(sub?.currentPeriodEnd.toISOString()).toBe(expected.toISOString());
  });

  it("pagamento recusado: marca RECUSADO e NÃO mexe na assinatura", async () => {
    // Nova cobrança (a do mês já foi paga; força um novo pendente noutro mês de referência)
    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    const created = await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub!.id,
        tenantId,
        amount: 49.9,
        status: "PENDENTE",
        referenceMonth: "2026-09",
        mpPaymentId: "mp-rejeitado",
      },
    });
    gw.paymentStatus.set("mp-rejeitado", "rejected");
    const before = await prisma.tenantSubscription.findUnique({ where: { tenantId } });

    await BillingService.handleWebhook("mp-rejeitado");

    const payment = await prisma.subscriptionPayment.findUnique({ where: { id: created.id } });
    expect(payment?.status).toBe("RECUSADO");
    const after = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(after?.currentPeriodEnd.toISOString()).toBe(before?.currentPeriodEnd.toISOString());
    expect(after?.status).toBe(before?.status);
  });

  it("webhook de pagamento desconhecido não explode (loga e segue)", async () => {
    gw.paymentStatus.set("mp-fantasma", "approved");
    await expect(BillingService.handleWebhook("mp-fantasma")).resolves.toBeUndefined();
  });
});

describe("Status para a tela de assinatura (polling)", () => {
  it("getStatus informa cobrança paga do mês e pendências", async () => {
    const status = await BillingService.getStatus(tenantId);
    expect(status).not.toBeNull();
    expect(status!.paidCharge).toBeTruthy(); // mp-2 aprovado neste mês
    expect(status!.sub.status).toBe("ATIVO");
  });
});

describe("Cobrança com CARTÃO (Card Brick)", () => {
  const card = { token: "tok_fake", paymentMethodId: "visa", installments: 1 };

  it("aprovado na hora: cria pagamento method=card APROVADO e ativa a assinatura (+1 mês)", async () => {
    const t = await createCardTenant();
    gw.nextCardStatus = "approved";
    const row = await BillingService.createOrGetMonthlyCharge(t, "card", card);
    expect(row.method).toBe("card");
    expect(row.status).toBe("APROVADO");

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("ATIVO");
    expect(sub?.trialEndsAt).toBeNull();
    const expected = new Date(periodEndInicial);
    expected.setMonth(expected.getMonth() + 1);
    expect(sub?.currentPeriodEnd.toISOString()).toBe(expected.toISOString());
  });

  it("em análise (pending) → só o webhook aprova depois, ativando a assinatura", async () => {
    const t = await createCardTenant();
    gw.nextCardStatus = "in_process";
    const row = await BillingService.createOrGetMonthlyCharge(t, "card", card);
    expect(row.status).toBe("PENDENTE");
    let sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("TRIAL"); // ainda não ativou

    // Webhook aprova depois.
    gw.paymentStatus.set(row.mpPaymentId!, "approved");
    await BillingService.handleWebhook(row.mpPaymentId!);
    const paid = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId: row.mpPaymentId! } });
    expect(paid?.status).toBe("APROVADO");
    sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("ATIVO");
  });

  it("recusado: marca RECUSADO e NÃO ativa a assinatura", async () => {
    const t = await createCardTenant();
    gw.nextCardStatus = "rejected";
    const row = await BillingService.createOrGetMonthlyCharge(t, "card", card);
    expect(row.status).toBe("RECUSADO");
    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("TRIAL");
  });

  it("cartão aprovado cancela um PIX PENDENTE do mesmo mês", async () => {
    const t = await createCardTenant();
    // Gera um PIX pendente primeiro.
    const pix = await BillingService.createOrGetMonthlyCharge(t, "pix");
    expect(pix.status).toBe("PENDENTE");
    // Paga no cartão.
    gw.nextCardStatus = "approved";
    await BillingService.createOrGetMonthlyCharge(t, "card", card);

    const pixRow = await prisma.subscriptionPayment.findUnique({ where: { id: pix.id } });
    expect(pixRow?.status).toBe("CANCELADO");
  });

  it("guarda: mensalidade do mês já paga recusa nova cobrança (pix ou cartão)", async () => {
    const t = await createCardTenant();
    gw.nextCardStatus = "approved";
    await BillingService.createOrGetMonthlyCharge(t, "card", card);

    await expect(BillingService.createOrGetMonthlyCharge(t, "card", card)).rejects.toThrow(
      /já está paga/i,
    );
    await expect(BillingService.createOrGetMonthlyCharge(t, "pix")).rejects.toThrow(
      /já está paga/i,
    );
  });

  it("cartão sem dados lança erro de negócio", async () => {
    const t = await createCardTenant();
    await expect(BillingService.createOrGetMonthlyCharge(t, "card")).rejects.toThrow(
      /cartão/i,
    );
  });
});
