<<<<<<< HEAD
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * O SDK do Mercado Pago é substituído por mocks: os testes cobrem a NOSSA
 * lógica (idempotência, corrida, reconciliação, correlação por referência).
 */
const mpMock = vi.hoisted(() => ({
  getPayment: vi.fn(),
  createPixPayment: vi.fn(),
  createCardPreference: vi.fn(),
=======
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

// ── Mock do gateway Mercado Pago (a integração real é coberta pela sandbox/produção) ──
const gw = vi.hoisted(() => ({
  createCalls: 0,
  cardCalls: 0,
  nextCardStatus: "approved", // status que o próximo createCardPayment devolve
  paymentStatus: new Map<string, string>(), // mpPaymentId -> status no "MP"
>>>>>>> f644e783a382991bbaf54b13f72f4aa83dfb88c6
}));

vi.mock("@/lib/payments/mercadopago", () => ({
  isMercadoPagoConfigured: () => true,
<<<<<<< HEAD
  assertMercadoPagoConfig: () => undefined,
  appUrl: () => "http://localhost:3000",
  webhookUrl: () => "http://localhost:3000/api/webhooks/mercadopago",
  getPayment: mpMock.getPayment,
  createPixPayment: mpMock.createPixPayment,
  createCardPreference: mpMock.createCardPreference,
}));

const { BillingService } = await import("@/lib/services/billing.service");

let tenantId = "";
let planId = "";
let subscriptionId = "";

/** Fim de mês de propósito: cobre a virada 31/08 → 30/09 (sem dias grátis). */
const PERIOD_END = new Date("2026-08-31T00:00:00.000Z");
const NEXT_PERIOD_END = "2026-09-30T00:00:00.000Z";

function refMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

beforeAll(async () => {
  tenantId = await createTestTenant("BILLING");
  await prisma.user.create({
    data: {
      tenantId,
      name: "Dono Teste",
      email: `owner-${tenantId}@ceasapro.test`,
=======
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
>>>>>>> f644e783a382991bbaf54b13f72f4aa83dfb88c6
      passwordHash: "x",
      role: "OWNER",
    },
  });
<<<<<<< HEAD
  const plan = await prisma.plan.create({
    data: { name: "Teste", slug: `teste-${tenantId}`, priceMonthly: 99 },
  });
  planId = plan.id;
  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: "VENCIDO",
      monthlyAmount: 99,
      currentPeriodEnd: PERIOD_END,
    },
  });
  subscriptionId = sub.id;
});

afterAll(async () => {
  await prisma.subscriptionPayment.deleteMany({ where: { tenantId } });
  await prisma.tenantSubscription.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await cleanupTenants([tenantId]);
  await prisma.plan.deleteMany({ where: { id: planId } });
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function resetSubscription() {
  await prisma.subscriptionPayment.deleteMany({ where: { tenantId } });
  await prisma.tenantSubscription.update({
    where: { id: subscriptionId },
    data: { status: "VENCIDO", currentPeriodEnd: PERIOD_END, trialEndsAt: null },
  });
}

describe("Cobrança PIX mensal — idempotência", () => {
  beforeEach(resetSubscription);

  it("reaproveita a cobrança do mês em vez de criar uma segunda", async () => {
    mpMock.createPixPayment.mockResolvedValue({
      mpPaymentId: "pix-1",
      status: "pending",
      qrCode: "000201-pix",
      qrCodeBase64: "AAAA",
      ticketUrl: "http://mp/ticket",
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const primeira = await BillingService.createOrGetMonthlyCharge(tenantId);
    const segunda = await BillingService.createOrGetMonthlyCharge(tenantId);

    expect(segunda.id).toBe(primeira.id);
    expect(mpMock.createPixPayment).toHaveBeenCalledTimes(1); // 2ª nem chamou o MP
    const total = await prisma.subscriptionPayment.count({
      where: { tenantId, referenceMonth: refMonth() },
    });
    expect(total).toBe(1);
  });

  it("uma cobrança pendente SEM qrCode não vira duplicata: a linha é atualizada", async () => {
    // Cenário do bug antigo: PIX criado sem QR → gerava um segundo pagamento no MP.
    mpMock.createPixPayment.mockResolvedValueOnce({
      mpPaymentId: "pix-sem-qr",
      status: "pending",
      qrCode: null,
      qrCodeBase64: null,
      ticketUrl: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const primeira = await BillingService.createOrGetMonthlyCharge(tenantId);
    expect(primeira.qrCode).toBeNull();

    // A idempotencyKey faz o MP devolver o MESMO pagamento.
    mpMock.createPixPayment.mockResolvedValueOnce({
      mpPaymentId: "pix-sem-qr",
      status: "pending",
      qrCode: "000201-pix",
      qrCodeBase64: "AAAA",
      ticketUrl: "http://mp/ticket",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const segunda = await BillingService.createOrGetMonthlyCharge(tenantId);

    expect(segunda.id).toBe(primeira.id);
    expect(segunda.qrCode).toBe("000201-pix");
    const total = await prisma.subscriptionPayment.count({ where: { tenantId } });
    expect(total).toBe(1);
  });

  it("gera nova cobrança quando o QR anterior expirou", async () => {
    mpMock.createPixPayment.mockResolvedValueOnce({
      mpPaymentId: "pix-expirado",
      status: "pending",
      qrCode: "qr-velho",
      qrCodeBase64: "AAAA",
      ticketUrl: null,
      expiresAt: new Date(Date.now() - 1000), // já expirou
    });
    const velha = await BillingService.createOrGetMonthlyCharge(tenantId);

    mpMock.createPixPayment.mockResolvedValueOnce({
      mpPaymentId: "pix-novo",
      status: "pending",
      qrCode: "qr-novo",
      qrCodeBase64: "BBBB",
      ticketUrl: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const nova = await BillingService.createOrGetMonthlyCharge(tenantId);

    expect(nova.id).not.toBe(velha.id);
    expect(nova.qrCode).toBe("qr-novo");
    expect(mpMock.createPixPayment).toHaveBeenCalledTimes(2);
  });
});

describe("Webhook — aplicação de status", () => {
  beforeEach(async () => {
    await resetSubscription();
    mpMock.createPixPayment.mockResolvedValue({
      mpPaymentId: "pix-hook",
      status: "pending",
      qrCode: "qr",
      qrCodeBase64: "AAAA",
      ticketUrl: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await BillingService.createOrGetMonthlyCharge(tenantId);
  });

  it("aprovação ativa a assinatura, estende 1 mês e grava o período", async () => {
    mpMock.getPayment.mockResolvedValue({
      id: "pix-hook",
      status: "approved",
      externalReference: null,
      amount: 99,
      method: "pix",
      paidAt: new Date("2026-08-20T10:00:00.000Z"),
    });

    expect(await BillingService.handleWebhook("pix-hook")).toBe("aplicado");

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    expect(sub.status).toBe("ATIVO");
    expect(sub.currentPeriodEnd.toISOString()).toBe(NEXT_PERIOD_END);

    const pay = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { mpPaymentId: "pix-hook" },
    });
    expect(pay.status).toBe("APROVADO");
    expect(pay.paidAt?.toISOString()).toBe("2026-08-20T10:00:00.000Z");
    expect(pay.periodStart?.toISOString()).toBe(PERIOD_END.toISOString());
    expect(pay.periodEnd?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("webhook repetido não estende o período de novo", async () => {
    mpMock.getPayment.mockResolvedValue({
      id: "pix-hook",
      status: "approved",
      externalReference: null,
      amount: 99,
      method: "pix",
      paidAt: null,
    });

    expect(await BillingService.handleWebhook("pix-hook")).toBe("aplicado");
    expect(await BillingService.handleWebhook("pix-hook")).toBe("ignorado");
    expect(await BillingService.handleWebhook("pix-hook")).toBe("ignorado");

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    expect(sub.currentPeriodEnd.toISOString()).toBe(NEXT_PERIOD_END); // só 1 mês
  });

  it("webhooks concorrentes aplicam a transição uma única vez", async () => {
    mpMock.getPayment.mockResolvedValue({
      id: "pix-hook",
      status: "approved",
      externalReference: null,
      amount: 99,
      method: "pix",
      paidAt: null,
    });

    const results = await Promise.all([
      BillingService.handleWebhook("pix-hook"),
      BillingService.handleWebhook("pix-hook"),
      BillingService.handleWebhook("pix-hook"),
    ]);
    expect(results.filter((r) => r === "aplicado")).toHaveLength(1);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    expect(sub.currentPeriodEnd.toISOString()).toBe(NEXT_PERIOD_END);
  });

  it("recusa não ativa a assinatura", async () => {
    mpMock.getPayment.mockResolvedValue({
      id: "pix-hook",
      status: "rejected",
      externalReference: null,
      amount: 99,
      method: "pix",
      paidAt: null,
    });
    expect(await BillingService.handleWebhook("pix-hook")).toBe("aplicado");

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    expect(sub.status).toBe("VENCIDO");
    expect(sub.currentPeriodEnd.toISOString()).toBe(PERIOD_END.toISOString());
  });

  it("pagamento desconhecido devolve nao_encontrado sem quebrar", async () => {
    mpMock.getPayment.mockResolvedValue({
      id: "de-outra-instalacao",
      status: "approved",
      externalReference: null,
      amount: 10,
      method: "pix",
      paidAt: null,
    });
    expect(await BillingService.handleWebhook("de-outra-instalacao")).toBe("nao_encontrado");
  });
});

describe("Checkout Pro (cartão) — correlação por referência externa", () => {
  beforeEach(resetSubscription);

  it("o pagamento do cartão é correlacionado e o mpPaymentId é anexado", async () => {
    mpMock.createCardPreference.mockResolvedValue({
      preferenceId: "pref-1",
      initPoint: "https://mp/checkout/pref-1",
    });

    const charge = await BillingService.createOrGetMonthlyCharge(tenantId, "card");
    expect(charge.mpPaymentId).toBeNull();
    expect(charge.mpPreferenceId).toBe("pref-1");
    expect(charge.ticketUrl).toBe("https://mp/checkout/pref-1");

    // O pagamento só existe no MP depois que o cliente paga.
    mpMock.getPayment.mockResolvedValue({
      id: "card-pay-1",
      status: "approved",
      externalReference: charge.mpExternalRef,
      amount: 99,
      method: "credit_card",
      paidAt: null,
    });
    expect(await BillingService.handleWebhook("card-pay-1")).toBe("aplicado");

    const atualizada = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: charge.id },
    });
    expect(atualizada.mpPaymentId).toBe("card-pay-1");
    expect(atualizada.status).toBe("APROVADO");

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    expect(sub.status).toBe("ATIVO");
  });

  it("reaproveita a preferência do mês", async () => {
    mpMock.createCardPreference.mockResolvedValue({
      preferenceId: "pref-2",
      initPoint: "https://mp/checkout/pref-2",
    });
    const a = await BillingService.createOrGetMonthlyCharge(tenantId, "card");
    const b = await BillingService.createOrGetMonthlyCharge(tenantId, "card");
    expect(b.id).toBe(a.id);
    expect(mpMock.createCardPreference).toHaveBeenCalledTimes(1);
  });
});

describe("reconcilePending — cura webhook perdido", () => {
  beforeEach(resetSubscription);

  it("consulta o MP e aprova a cobrança pendente antiga", async () => {
    // Cobrança criada há 1 hora e nenhum webhook recebido.
    const criada = new Date(Date.now() - 60 * 60 * 1000);
    const pay = await prisma.subscriptionPayment.create({
      data: {
        subscriptionId,
        tenantId,
        amount: 99,
        status: "PENDENTE",
        method: "pix",
        referenceMonth: refMonth(),
        mpPaymentId: "pix-perdido",
        mpExternalRef: `sub:${subscriptionId}:${refMonth()}:pix`,
        qrCode: "qr",
        createdAt: criada,
      },
    });

    mpMock.getPayment.mockResolvedValue({
      id: "pix-perdido",
      status: "approved",
      externalReference: pay.mpExternalRef,
      amount: 99,
      method: "pix",
      paidAt: null,
    });

    const r = await BillingService.reconcilePending();
    expect(r.verificados).toBe(1);
    expect(r.atualizados).toBe(1);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    expect(sub.status).toBe("ATIVO");
  });

  it("ignora cobranças recém-criadas (deixa o webhook trabalhar)", async () => {
    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId,
        tenantId,
        amount: 99,
        status: "PENDENTE",
        method: "pix",
        referenceMonth: refMonth(),
        mpPaymentId: "pix-recente",
        qrCode: "qr",
      },
    });

    const r = await BillingService.reconcilePending();
    expect(r.verificados).toBe(0);
    expect(mpMock.getPayment).not.toHaveBeenCalled();
  });

  it("falha em uma cobrança não interrompe as demais", async () => {
    const criada = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.subscriptionPayment.createMany({
      data: [
        {
          subscriptionId,
          tenantId,
          amount: 99,
          status: "PENDENTE",
          method: "pix",
          referenceMonth: refMonth(),
          mpPaymentId: "pix-erro",
          qrCode: "qr",
          createdAt: criada,
        },
        {
          subscriptionId,
          tenantId,
          amount: 99,
          status: "PENDENTE",
          method: "pix",
          referenceMonth: refMonth(),
          mpPaymentId: "pix-ok",
          qrCode: "qr",
          createdAt: new Date(criada.getTime() + 1000),
        },
      ],
    });

    mpMock.getPayment.mockImplementation(async (id: string) => {
      if (id === "pix-erro") throw new Error("timeout na API do MP");
      return {
        id,
        status: "approved",
        externalReference: null,
        amount: 99,
        method: "pix",
        paidAt: null,
      };
    });

    const r = await BillingService.reconcilePending();
    expect(r.verificados).toBe(2);
    expect(r.atualizados).toBe(1);

    const ok = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { mpPaymentId: "pix-ok" },
    });
    expect(ok.status).toBe("APROVADO");
=======
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
>>>>>>> f644e783a382991bbaf54b13f72f4aa83dfb88c6
  });
});
