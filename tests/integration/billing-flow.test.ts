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
}));

vi.mock("@/lib/payments/mercadopago", () => ({
  isMercadoPagoConfigured: () => true,
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
      passwordHash: "x",
      role: "OWNER",
    },
  });
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
  });
});
