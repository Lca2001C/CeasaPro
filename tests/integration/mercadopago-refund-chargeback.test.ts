import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import { createRefreshToken, rotateRefreshToken } from "@/lib/auth/refresh";

/**
 * Reversão de pagamento no Mercado Pago.
 *
 * Estorno e chargeback são o caminho inverso da aprovação: o mês pago deixa de
 * valer, o acesso cai na hora e as sessões abertas são derrubadas. Chargeback é
 * tratado como mais grave, porque envolve contestação formal junto ao emissor.
 */

const gw = vi.hoisted(() => ({
  // mpPaymentId -> status corrente no "Mercado Pago"
  paymentStatus: new Map<string, string>(),
  cardCalls: 0,
}));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    createCardPayment: vi.fn(async () => {
      gw.cardCalls += 1;
      const id = `mp-rev-${gw.cardCalls}`;
      gw.paymentStatus.set(id, "approved");
      return { mpPaymentId: id, status: "approved", statusDetail: "accredited", threeDs: null };
    }),
    getPayment: vi.fn(async (id: string) => {
      const status = gw.paymentStatus.get(id) ?? "pending";
      return {
        id,
        status,
        statusDetail: status === "approved" ? "accredited" : status,
        externalReference: null,
        amount: 49.9,
        method: "visa",
        paymentTypeId: "credit_card",
        paidAt: status === "approved" ? new Date() : null,
      };
    }),
    verifyWebhookSignature: () => true,
  };
});

import { BillingService } from "@/lib/services/billing.service";
import { accessDecision } from "@/lib/billing/status";
import { PaymentRequiredError } from "@/lib/http/app-error";
import type { CardPaymentInput } from "@/lib/validations/billing";

const cardInput: CardPaymentInput = {
  method: "CREDIT_CARD",
  token: "tok_fake",
  paymentMethodId: "visa",
  installments: 1,
  payer: { email: "pagador@teste.com" },
  acceptedTerms: true,
};

let planId = "";
const tenants: string[] = [];

/** Empresa nova (nunca pagou) com dono e uma sessão aberta. */
async function createTenantComSessao(): Promise<{ tenantId: string; refreshToken: string }> {
  const tenantId = await createTestTenant("REVERSAO MP");
  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: "SUSPENSO",
      monthlyAmount: 49.9,
      activatedAt: null,
      currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
      graceDays: 5,
    },
  });
  const owner = await prisma.user.create({
    data: {
      tenantId,
      name: "Dono Reversao",
      email: `reversao-${tenantId}@teste.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  const refreshToken = await createRefreshToken(owner.id);
  tenants.push(tenantId);
  return { tenantId, refreshToken };
}

/** Paga a mensalidade por cartão e devolve o id do pagamento no Mercado Pago. */
async function pagarMensalidade(tenantId: string): Promise<string> {
  const result = await BillingService.processCardPayment(tenantId, cardInput);
  expect(result.status).toBe("APROVADO");
  const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
  expect(sub?.status).toBe("ATIVO");
  return result.mpPaymentId!;
}

beforeAll(async () => {
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Teste Reversao",
      slug: `teste-reversao-${Date.now()}`,
      priceMonthly: 49.9,
      active: true,
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
});

describe("Estorno (refunded)", () => {
  it("suspende a assinatura, reverte o período e revoga as sessões", async () => {
    const { tenantId, refreshToken } = await createTenantComSessao();
    const mpId = await pagarMensalidade(tenantId);
    const pago = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId: mpId } });

    gw.paymentStatus.set(mpId, "refunded");
    await BillingService.handleWebhook(mpId);

    const payment = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId: mpId } });
    expect(payment?.status).toBe("ESTORNADO");

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe("SUSPENSO");
    // O mês estornado deixa de valer: o vencimento volta ao início do período.
    expect(sub?.currentPeriodEnd.toISOString()).toBe(pago!.periodStart!.toISOString());
    // MANUAL impede o cron de devolver o acesso pela tolerância de graceDays.
    expect(sub?.statusSource).toBe("MANUAL");
    expect(sub?.statusReason).toContain("refunded");

    // Sessão aberta não renova mais: o refresh token foi revogado.
    expect(await rotateRefreshToken(refreshToken)).toBeNull();
  });

  it("bloqueia o acesso e faz a API responder 402", async () => {
    const { tenantId } = await createTenantComSessao();
    const mpId = await pagarMensalidade(tenantId);
    gw.paymentStatus.set(mpId, "refunded");
    await BillingService.handleWebhook(mpId);

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(accessDecision("ACTIVE", sub!.status)).toBe("blocked");
    expect(new PaymentRequiredError().status).toBe(402);
  });

  it("registra ACCESS_REVOKED na auditoria", async () => {
    const { tenantId } = await createTenantComSessao();
    const mpId = await pagarMensalidade(tenantId);
    gw.paymentStatus.set(mpId, "refunded");
    await BillingService.handleWebhook(mpId);

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "ACCESS_REVOKED", entity: "TenantSubscription" },
    });
    expect(log).not.toBeNull();
    expect(log!.newData).toMatchObject({
      status: "SUSPENSO",
      mpStatus: "refunded",
      sessionsRevoked: true,
    });
  });

  it("reentrega do mesmo webhook não reverte duas vezes (idempotência)", async () => {
    const { tenantId } = await createTenantComSessao();
    const mpId = await pagarMensalidade(tenantId);
    gw.paymentStatus.set(mpId, "refunded");
    await BillingService.handleWebhook(mpId);

    const antes = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(await BillingService.handleWebhook(mpId)).toBe("ignorado");

    const depois = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(depois?.currentPeriodEnd.toISOString()).toBe(antes!.currentPeriodEnd.toISOString());
    const revogacoes = await prisma.auditLog.count({
      where: { tenantId, action: "ACCESS_REVOKED" },
    });
    expect(revogacoes).toBe(1);
  });
});

describe("Chargeback (charged_back)", () => {
  it("bloqueia a conta e exige revisão humana para reativar", async () => {
    const { tenantId, refreshToken } = await createTenantComSessao();
    const mpId = await pagarMensalidade(tenantId);

    gw.paymentStatus.set(mpId, "charged_back");
    await BillingService.handleWebhook(mpId);

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    // BLOQUEADO (e não SUSPENSO): contestação junto ao emissor é mais grave.
    expect(sub?.status).toBe("BLOQUEADO");
    expect(sub?.statusSource).toBe("MANUAL");
    expect(accessDecision("ACTIVE", sub!.status)).toBe("blocked");
    expect(await rotateRefreshToken(refreshToken)).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, action: "ACCESS_REVOKED" },
    });
    expect(log!.newData).toMatchObject({ status: "BLOQUEADO", mpStatus: "charged_back" });
  });

  it("o cron não reativa sozinho uma conta bloqueada por chargeback", async () => {
    const { tenantId } = await createTenantComSessao();
    const mpId = await pagarMensalidade(tenantId);
    gw.paymentStatus.set(mpId, "charged_back");
    await BillingService.handleWebhook(mpId);

    await BillingService.recomputeStatuses();

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe("BLOQUEADO");
  });
});

describe("Cancelamento (cancelled)", () => {
  it("suspende a assinatura como um estorno comum", async () => {
    const { tenantId } = await createTenantComSessao();
    const mpId = await pagarMensalidade(tenantId);

    gw.paymentStatus.set(mpId, "cancelled");
    await BillingService.handleWebhook(mpId);

    const payment = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId: mpId } });
    expect(payment?.status).toBe("CANCELADO");

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe("SUSPENSO");
  });
});

describe("Recuperação depois da reversão", () => {
  it("um novo pagamento aprovado devolve o acesso e volta o statusSource para AUTO", async () => {
    const { tenantId } = await createTenantComSessao();
    const mpId = await pagarMensalidade(tenantId);
    gw.paymentStatus.set(mpId, "refunded");
    await BillingService.handleWebhook(mpId);

    // O mês de referência voltou a ficar em aberto, então nova cobrança é aceita.
    const novoMpId = await pagarMensalidade(tenantId);
    expect(novoMpId).not.toBe(mpId);

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe("ATIVO");
    expect(sub?.statusSource).toBe("AUTO");
    expect(sub?.statusReason).toBeNull();
    expect(sub?.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    expect(accessDecision("ACTIVE", sub!.status)).toBe("ok");
  });
});
