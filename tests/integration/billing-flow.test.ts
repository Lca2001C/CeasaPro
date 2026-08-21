import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import type { CardPaymentInput } from "@/lib/validations/billing";

// ── Mock do gateway Mercado Pago (a integração real é coberta pela sandbox/produção) ──
const gw = vi.hoisted(() => ({
  createCalls: 0,
  cardCalls: 0,
  nextCardStatus: "approved", // status que o próximo createCardPayment devolve
  nextThreeDs: null as { externalResourceUrl: string; creq: string } | null,
  paymentStatus: new Map<string, string>(), // mpPaymentId -> status no "MP"
  paymentType: new Map<string, string>(), // mpPaymentId -> payment_type_id no "MP"
}));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    createPixPayment: vi.fn(async () => {
      gw.createCalls += 1;
      const id = `mp-${gw.createCalls}`;
      gw.paymentStatus.set(id, "pending");
      gw.paymentType.set(id, "bank_transfer");
      return {
        mpPaymentId: id,
        status: "pending",
        qrCode: `PIXCOPIAECOLA-${id}`,
        qrCodeBase64: "aW1hZ2VtLWZha2U=",
        ticketUrl: `https://mp.fake/${id}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    }),
    createCardPayment: vi.fn(async (args: { paymentTypeId: string }) => {
      gw.cardCalls += 1;
      const id = `mpc-${gw.cardCalls}`;
      gw.paymentStatus.set(id, gw.nextThreeDs ? "pending" : gw.nextCardStatus);
      gw.paymentType.set(id, args.paymentTypeId);
      return {
        mpPaymentId: id,
        status: gw.nextThreeDs ? "pending" : gw.nextCardStatus,
        statusDetail: gw.nextThreeDs ? "pending_challenge" : "accredited",
        threeDs: gw.nextThreeDs,
      };
    }),
    getPayment: vi.fn(async (id: string) => {
      const status = gw.paymentStatus.get(id) ?? "pending";
      const paymentTypeId = gw.paymentType.get(id) ?? "bank_transfer";
      return {
        id,
        status,
        statusDetail: status === "approved" ? "accredited" : "pending_waiting_transfer",
        externalReference: null,
        amount: 49.9,
        method: paymentTypeId === "bank_transfer" ? "pix" : "visa",
        paymentTypeId,
        paidAt: status === "approved" ? new Date("2026-08-20T12:00:00.000Z") : null,
      };
    }),
    verifyWebhookSignature: () => true,
  };
});

import { BillingService } from "@/lib/services/billing.service";
import { addOneMonth } from "@/lib/billing/status";

let tenantId = "";
let planId = "";
const periodEndInicial = new Date("2026-08-01T00:00:00Z");
const cardTenants: string[] = [];

const creditoInput: CardPaymentInput = {
  method: "CREDIT_CARD",
  token: "tok_fake",
  paymentMethodId: "visa",
  installments: 1,
  payer: { email: "pagador@teste.com" },
  acceptedTerms: true,
};

const debitoInput: CardPaymentInput = {
  method: "DEBIT_CARD",
  token: "tok_debito",
  paymentMethodId: "debvisa",
  installments: 1,
  payer: {
    email: "pagador@teste.com",
    identification: { type: "CPF", number: "12345678909" },
  },
  acceptedTerms: true,
};

/**
 * Confere a renovação de quem nunca pagou: como `currentPeriodEnd` nasce no
 * passado, o novo ciclo tem de começar HOJE — se partisse da data velha, o mês
 * recém-pago já nasceria vencido e a empresa seguiria bloqueada.
 */
function expectCicloComecandoHoje(periodStart: Date | null, periodEnd: Date | null) {
  expect(periodStart).toBeTruthy();
  expect(periodEnd).toBeTruthy();
  const agora = Date.now();
  expect(Math.abs(periodStart!.getTime() - agora)).toBeLessThan(60_000);
  expect(periodEnd!.toISOString()).toBe(addOneMonth(periodStart!).toISOString());
  expect(periodEnd!.getTime()).toBeGreaterThan(agora);
}

// Cria um tenant isolado (assinatura ainda sem pagamento + OWNER) para um cenário de cartão.
async function createCardTenant(): Promise<string> {
  const id = await createTestTenant("BILLING CARD");
  await prisma.tenantSubscription.create({
    data: {
      tenantId: id,
      planId,
      status: "SUSPENSO",
      monthlyAmount: 49.9,
      activatedAt: null,
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
      status: "SUSPENSO",
      monthlyAmount: 49.9,
      activatedAt: null,
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
    const charge = await BillingService.createCheckout(tenantId);
    expect(charge.status).toBe("PENDENTE");
    expect(charge.method).toBe("PIX");
    expect(charge.qrCode).toContain("PIXCOPIAECOLA");
    expect(charge.qrCodeBase64).toBeTruthy();
    expect(charge.expiresAt).toBeTruthy();
    expect(gw.createCalls).toBe(1);
  });

  it("é idempotente no mês: segunda chamada devolve a MESMA cobrança sem chamar o MP", async () => {
    const again = await BillingService.createCheckout(tenantId);
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
    const renewed = await BillingService.createCheckout(tenantId);
    expect(gw.createCalls).toBe(2);
    expect(renewed.mpPaymentId).toBe("mp-2");

    const old = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId: "mp-1" } });
    expect(old?.status).toBe("CANCELADO");
  });

  it("cartão não passa pelo checkout PIX (exige token do Brick)", async () => {
    await expect(
      BillingService.createCheckout(tenantId, { method: "CREDIT_CARD", acceptedTerms: true }),
    ).rejects.toThrow(/cartão/i);
  });
});

describe("Webhook de pagamento (idempotente, ativa a assinatura)", () => {
  it("pagamento aprovado: marca APROVADO, ativa a assinatura e avança o vencimento 1 mês", async () => {
    gw.paymentStatus.set("mp-2", "approved");
    await BillingService.handleWebhook("mp-2");

    const payment = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId: "mp-2" } });
    expect(payment?.status).toBe("APROVADO");
    expect(payment?.paidAt).toBeTruthy();
    expect(payment?.statusDetail).toBe("accredited");

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe("ATIVO");
    expect(sub?.activatedAt).toBeTruthy(); // primeira ativação registrada
    expectCicloComecandoHoje(payment!.periodStart, payment!.periodEnd);
    expect(sub?.currentPeriodEnd.toISOString()).toBe(payment!.periodEnd!.toISOString());
  });

  it("reentrega do mesmo webhook NÃO avança o vencimento de novo (idempotência)", async () => {
    const antes = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    await BillingService.handleWebhook("mp-2");
    const depois = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(depois?.currentPeriodEnd.toISOString()).toBe(antes!.currentPeriodEnd.toISOString());
    expect(depois?.activatedAt?.toISOString()).toBe(antes!.activatedAt?.toISOString());
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
    await expect(BillingService.handleWebhook("mp-fantasma")).resolves.toBe("nao_encontrado");
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

describe("Cobrança com CARTÃO (Payment Brick)", () => {
  it("crédito aprovado na hora: grava CREDIT_CARD APROVADO e ativa a assinatura (+1 mês)", async () => {
    const t = await createCardTenant();
    gw.nextCardStatus = "approved";
    gw.nextThreeDs = null;

    const result = await BillingService.processCardPayment(t, creditoInput);
    expect(result.status).toBe("APROVADO");
    expect(result.threeDsUrl).toBeNull();

    const row = await prisma.subscriptionPayment.findUnique({
      where: { mpPaymentId: result.mpPaymentId! },
    });
    expect(row?.method).toBe("CREDIT_CARD");

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("ATIVO");
    expect(sub?.activatedAt).toBeTruthy();
    expectCicloComecandoHoje(row!.periodStart, row!.periodEnd);
    expect(sub?.currentPeriodEnd.toISOString()).toBe(row!.periodEnd!.toISOString());
  });

  it("em análise (pending) → só o webhook aprova depois, ativando a assinatura", async () => {
    const t = await createCardTenant();
    gw.nextCardStatus = "in_process";
    gw.nextThreeDs = null;

    const result = await BillingService.processCardPayment(t, creditoInput);
    expect(result.status).toBe("PENDENTE");
    let sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("SUSPENSO"); // ainda não ativou
    expect(sub?.activatedAt).toBeNull();

    // Webhook aprova depois.
    gw.paymentStatus.set(result.mpPaymentId!, "approved");
    await BillingService.handleWebhook(result.mpPaymentId!);
    const paid = await prisma.subscriptionPayment.findUnique({
      where: { mpPaymentId: result.mpPaymentId! },
    });
    expect(paid?.status).toBe("APROVADO");
    sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("ATIVO");
  });

  it("recusado: marca RECUSADO e NÃO ativa a assinatura", async () => {
    const t = await createCardTenant();
    gw.nextCardStatus = "rejected";
    gw.nextThreeDs = null;

    const result = await BillingService.processCardPayment(t, creditoInput);
    expect(result.status).toBe("RECUSADO");
    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("SUSPENSO");
    expect(sub?.activatedAt).toBeNull();
  });

  it("cartão aprovado cancela um PIX PENDENTE do mesmo mês", async () => {
    const t = await createCardTenant();
    const pix = await BillingService.createCheckout(t);
    expect(pix.status).toBe("PENDENTE");

    gw.nextCardStatus = "approved";
    gw.nextThreeDs = null;
    await BillingService.processCardPayment(t, creditoInput);

    const pixRow = await prisma.subscriptionPayment.findUnique({ where: { id: pix.id } });
    expect(pixRow?.status).toBe("CANCELADO");
  });

  it("guarda: mensalidade do mês já paga recusa nova cobrança (pix ou cartão)", async () => {
    const t = await createCardTenant();
    gw.nextCardStatus = "approved";
    gw.nextThreeDs = null;
    await BillingService.processCardPayment(t, creditoInput);

    await expect(BillingService.processCardPayment(t, creditoInput)).rejects.toThrow(
      /já está paga/i,
    );
    await expect(BillingService.createCheckout(t)).rejects.toThrow(/já está paga/i);
  });
});

describe("Cartão de DÉBITO com autenticação 3DS", () => {
  it("desafio 3DS: cobrança fica PENDENTE com a URL do desafio e só o webhook aprova", async () => {
    const t = await createCardTenant();
    gw.nextThreeDs = {
      externalResourceUrl: "https://acs.banco.fake/challenge",
      creq: "eyJjcmVxIjoiZmFrZSJ9",
    };

    const result = await BillingService.processCardPayment(t, debitoInput);
    expect(result.status).toBe("PENDENTE");
    expect(result.threeDsUrl).toBe("https://acs.banco.fake/challenge");
    expect(result.threeDsCreq).toBe("eyJjcmVxIjoiZmFrZSJ9");

    const row = await prisma.subscriptionPayment.findUnique({
      where: { mpPaymentId: result.mpPaymentId! },
    });
    expect(row?.method).toBe("DEBIT_CARD");
    expect(row?.threeDsUrl).toBe("https://acs.banco.fake/challenge");
    expect(row?.statusDetail).toBe("pending_challenge");

    let sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("SUSPENSO"); // ainda não autenticou

    // Portador autentica → o Mercado Pago aprova e avisa pelo webhook.
    gw.paymentStatus.set(result.mpPaymentId!, "approved");
    await BillingService.handleWebhook(result.mpPaymentId!);

    const paid = await prisma.subscriptionPayment.findUnique({
      where: { mpPaymentId: result.mpPaymentId! },
    });
    expect(paid?.status).toBe("APROVADO");
    expect(paid?.threeDsUrl).toBeNull(); // desafio consumido
    sub = await prisma.tenantSubscription.findUnique({ where: { tenantId: t } });
    expect(sub?.status).toBe("ATIVO");
  });

  it("débito sem CPF do titular é recusado antes de chamar o Mercado Pago", async () => {
    const t = await createCardTenant();
    gw.nextThreeDs = null;
    const semCpf = { ...debitoInput, payer: { email: "pagador@teste.com" } };
    await expect(BillingService.processCardPayment(t, semCpf)).rejects.toThrow(/CPF/i);
  });
});
