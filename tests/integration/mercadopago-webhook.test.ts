import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import type { ChargeMethod } from "@prisma/client";

// Só o acesso HTTP ao Mercado Pago é mockado: a verificação de assinatura roda
// de verdade, porque é ela que protege o endpoint público do webhook.
const gw = vi.hoisted(() => ({
  paymentStatus: new Map<string, string>(),
  paymentType: new Map<string, string>(),
}));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
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
  };
});

import { BillingService } from "@/lib/services/billing.service";
import { verifyWebhookSignature, WEBHOOK_MAX_SKEW_SECONDS } from "@/lib/payments/mercadopago";
import { addOneMonth } from "@/lib/billing/status";

const SECRET = "segredo-do-webhook";
const REQUEST_ID = "req-webhook-1";

function assinar(dataId: string, ts: number, secret = SECRET) {
  const manifest = `id:${dataId};request-id:${REQUEST_ID};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

let planId = "";
const tenants: string[] = [];
const periodEnd = new Date("2026-08-01T00:00:00Z");

/**
 * Empresa SUSPENSA com uma cobrança pendente do mês — o cenário real em que o
 * webhook precisa reativar o acesso.
 */
async function criarTenantSuspenso(mpPaymentId: string, method: ChargeMethod) {
  const tenantId = await createTestTenant("WEBHOOK MP");
  tenants.push(tenantId);
  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: "SUSPENSO",
      monthlyAmount: 49.9,
      // Cliente antigo que deixou vencer: já pagou no passado, por isso tem
      // `activatedAt`. O vencimento ficou para trás e o acesso caiu.
      activatedAt: new Date("2026-06-01T00:00:00Z"),
      currentPeriodEnd: periodEnd,
      graceDays: 5,
    },
  });
  const now = new Date();
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: sub.id,
      tenantId,
      amount: 49.9,
      status: "PENDENTE",
      method,
      referenceMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      mpPaymentId,
    },
  });
  return tenantId;
}

beforeAll(async () => {
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Teste Webhook",
      slug: `teste-webhook-${Date.now()}`,
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

beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Assinatura do webhook (proteção do endpoint público)", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const ts = Math.floor(now.getTime() / 1000);

  it("aceita a notificação assinada com o segredo correto", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar("123", ts),
        xRequestId: REQUEST_ID,
        dataId: "123",
        now,
      }),
    ).toBe("123");
  });

  it("rejeita corpo adulterado: o data.id assinado não é o recebido", () => {
    expect(
      verifyWebhookSignature({
        xSignature: assinar("123", ts),
        xRequestId: REQUEST_ID,
        dataId: "456",
        now,
      }),
    ).toBeNull();
  });

  it("adulterar SÓ o corpo não muda o pagamento processado", () => {
    // A assinatura cobre o id "123" (query). Mandar "456" no corpo não deve
    // fazer o endpoint processar "456": o que vale é o id que fechou o HMAC.
    expect(
      verifyWebhookSignature({
        xSignature: assinar("123", ts),
        xRequestId: REQUEST_ID,
        dataId: "123",
        dataIdAlt: "456",
        now,
      }),
    ).toBe("123");
  });

  it("rejeita replay: notificação legítima reenviada fora da janela", () => {
    const velho = ts - (WEBHOOK_MAX_SKEW_SECONDS + 1);
    expect(
      verifyWebhookSignature({
        xSignature: assinar("123", velho),
        xRequestId: REQUEST_ID,
        dataId: "123",
        now,
      }),
    ).toBeNull();
  });
});

describe("Webhook reativa a assinatura nos três métodos", () => {
  const casos: Array<{ nome: string; method: ChargeMethod; paymentTypeId: string }> = [
    { nome: "PIX", method: "PIX", paymentTypeId: "bank_transfer" },
    { nome: "crédito", method: "CREDIT_CARD", paymentTypeId: "credit_card" },
    { nome: "débito", method: "DEBIT_CARD", paymentTypeId: "debit_card" },
  ];

  for (const caso of casos) {
    it(`${caso.nome}: SUSPENSO vira ATIVO e o vencimento avança 1 mês`, async () => {
      const mpPaymentId = `wh-${caso.method}`;
      const tenantId = await criarTenantSuspenso(mpPaymentId, caso.method);
      gw.paymentStatus.set(mpPaymentId, "approved");
      gw.paymentType.set(mpPaymentId, caso.paymentTypeId);

      await expect(BillingService.handleWebhook(mpPaymentId)).resolves.toBe("aplicado");

      const payment = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId } });
      expect(payment?.status).toBe("APROVADO");
      expect(payment?.method).toBe(caso.method);
      expect(payment?.statusDetail).toBe("accredited");

      const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
      expect(sub?.status).toBe("ATIVO");
      // O vencimento antigo ficou no passado, então o novo ciclo começa hoje —
      // se partisse da data velha, o mês pago já nasceria vencido.
      expect(Math.abs(payment!.periodStart!.getTime() - Date.now())).toBeLessThan(60_000);
      expect(sub?.currentPeriodEnd.toISOString()).toBe(
        addOneMonth(payment!.periodStart!).toISOString(),
      );
      expect(sub!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    });
  }

  it("reentrega da mesma notificação não cobra nem estende o período de novo", async () => {
    const mpPaymentId = "wh-duplicado";
    const tenantId = await criarTenantSuspenso(mpPaymentId, "PIX");
    gw.paymentStatus.set(mpPaymentId, "approved");

    await expect(BillingService.handleWebhook(mpPaymentId)).resolves.toBe("aplicado");
    const depoisDaPrimeira = await prisma.tenantSubscription.findUnique({ where: { tenantId } });

    await expect(BillingService.handleWebhook(mpPaymentId)).resolves.toBe("ignorado");
    await expect(BillingService.handleWebhook(mpPaymentId)).resolves.toBe("ignorado");

    const final = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(final?.currentPeriodEnd.toISOString()).toBe(
      depoisDaPrimeira?.currentPeriodEnd.toISOString(),
    );
  });
});
