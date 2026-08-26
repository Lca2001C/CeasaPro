import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { CardPaymentInput } from "@/lib/validations/billing";

/**
 * Escolha do plano no PRIMEIRO pagamento + as correções que ela expôs no
 * caminho de cobrança. O gateway é mockado; a integração real é exercitada na
 * sandbox do Mercado Pago.
 */
const gw = vi.hoisted(() => ({
  pixCalls: 0,
  cardCalls: 0,
  /** Valor que o último createPixPayment recebeu — prova qual preço foi cobrado. */
  lastPixAmount: 0,
  lastCardAmount: 0,
  /** mpPaymentId devolvido pelo próximo createCardPayment (idempotência do MP). */
  nextCardId: "card-fixo",
  status: new Map<string, string>(),
}));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    createPixPayment: vi.fn(async (args: { amount: number }) => {
      gw.pixCalls += 1;
      gw.lastPixAmount = args.amount;
      const id = `pix-${gw.pixCalls}`;
      gw.status.set(id, "pending");
      return {
        mpPaymentId: id,
        status: "pending",
        qrCode: `QR-${id}`,
        qrCodeBase64: "aW1n",
        ticketUrl: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    }),
    createCardPayment: vi.fn(async (args: { amount: number }) => {
      gw.cardCalls += 1;
      gw.lastCardAmount = args.amount;
      // Idempotência do Mercado Pago: mesma cobrança + mesmo token = mesmo id.
      const id = gw.nextCardId;
      gw.status.set(id, "rejected");
      return {
        mpPaymentId: id,
        status: "rejected",
        statusDetail: "cc_rejected_insufficient_amount",
        threeDs: null,
      };
    }),
    getPayment: vi.fn(async (id: string) => {
      // `reconcilePendingPayments` é um cron: varre o banco INTEIRO, inclusive
      // cobranças criadas por outros arquivos de teste rodando em paralelo.
      // Falhar em id desconhecido faz o laço pular a linha (ele já trata erro
      // por cobrança) em vez de aplicar um status inventado sobre dado alheio.
      const status = gw.status.get(id);
      if (!status) throw new Error(`pagamento fora deste teste: ${id}`);
      return {
        id,
        status,
        statusDetail: status,
        externalReference: null,
        amount: 0,
        method: "visa",
        paymentTypeId: "credit_card",
        paidAt: status === "approved" ? new Date() : null,
      };
    }),
  };
});

import { BillingService } from "@/lib/services/billing.service";

const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
const planIds: string[] = [];
let basicoId = "";
let completoId = "";

/** Empresa recém-criada: suspensa, nunca pagou, no plano Básico. */
async function novoCliente(): Promise<string> {
  const id = await createTestTenant("PLANO CHECKOUT");
  await prisma.tenantSubscription.create({
    data: {
      tenantId: id,
      planId: basicoId,
      status: "SUSPENSO",
      monthlyAmount: 29.9,
      activatedAt: null,
      currentPeriodEnd: new Date("2026-01-01T00:00:00Z"),
      graceDays: 5,
    },
  });
  await prisma.user.create({
    data: {
      tenantId: id,
      name: "Dono",
      email: `dono-${uniq()}@t.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  tenants.push(id);
  return id;
}

beforeAll(async () => {
  const basico = await prisma.plan.create({
    data: {
      name: "Básico Checkout",
      slug: `basico-ck-${uniq()}`,
      priceMonthly: 29.9,
      maxUsers: 3,
      active: true,
      features: { modules: [] },
    },
  });
  const completo = await prisma.plan.create({
    data: {
      name: "Completo Checkout",
      slug: `completo-ck-${uniq()}`,
      priceMonthly: 99.9,
      maxUsers: 10,
      active: true,
      features: { modules: ["caixas", "higienizacao"] },
    },
  });
  basicoId = basico.id;
  completoId = completo.id;
  planIds.push(basicoId, completoId);
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
});

describe("Escolha de plano no primeiro pagamento", () => {
  it("cobra o plano escolhido, e não o que veio do cadastro", async () => {
    const tenantId = await novoCliente();
    const ctx = makeCtx(tenantId);

    const charge = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: completoId },
      ctx,
    );

    expect(Number(charge.amount)).toBe(99.9);
    expect(gw.lastPixAmount).toBe(99.9); // o valor que foi ao Mercado Pago
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.planId).toBe(completoId);
    expect(Number(sub.monthlyAmount)).toBe(99.9);
  });

  it("sem planId escolhido mantém o plano atual", async () => {
    const tenantId = await novoCliente();
    const charge = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      makeCtx(tenantId),
    );
    expect(Number(charge.amount)).toBe(29.9);
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.planId).toBe(basicoId);
  });

  it("trocar de plano com um QR em aberto gera um QR NOVO no valor certo", async () => {
    const tenantId = await novoCliente();
    const ctx = makeCtx(tenantId);

    const primeira = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    expect(Number(primeira.amount)).toBe(29.9);

    const segunda = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: completoId },
      ctx,
    );

    // Cobrança diferente, no valor novo — devolver a antiga faria a empresa
    // pagar 29,90 e receber o plano de 99,90.
    expect(segunda.id).not.toBe(primeira.id);
    expect(Number(segunda.amount)).toBe(99.9);
    expect(gw.lastPixAmount).toBe(99.9);

    const antiga = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: primeira.id },
    });
    expect(antiga.status).toBe("CANCELADO");
  });

  it("mês já pago recusa a cobrança SEM ter trocado o plano", async () => {
    const tenantId = await novoCliente();
    const ctx = makeCtx(tenantId);
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });

    const refMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        tenantId,
        amount: 29.9,
        status: "APROVADO",
        method: "PIX",
        referenceMonth: refMonth,
        mpPaymentId: `pago-${uniq()}`,
      },
    });

    await expect(
      BillingService.createCheckout(
        tenantId,
        { method: "PIX", acceptedTerms: true, planId: completoId },
        ctx,
      ),
    ).rejects.toThrow(/já está paga/i);

    // A guarda vem antes da troca: o plano não pode ter mudado sem cobrança.
    const depois = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(depois.planId).toBe(basicoId);
    expect(Number(depois.monthlyAmount)).toBe(29.9);
  });
});

describe("Nova tentativa com o MESMO cartão após recusa", () => {
  it("não estoura o índice único de mpPaymentId", async () => {
    const tenantId = await novoCliente();
    const ctx = makeCtx(tenantId);
    gw.nextCardId = `card-retry-${uniq()}`;

    const input: CardPaymentInput = {
      method: "CREDIT_CARD",
      token: "tok_mesmo_cartao",
      paymentMethodId: "visa",
      installments: 1,
      payer: { email: "pagador@teste.com" },
      acceptedTerms: true,
    };

    const primeira = await BillingService.processCardPayment(tenantId, input, ctx);
    expect(primeira.status).toBe("RECUSADO");

    // O Mercado Pago devolve o MESMO pagamento (idempotência determinística).
    // Antes do upsert isto batia no índice único e virava 500.
    const segunda = await BillingService.processCardPayment(tenantId, input, ctx);
    expect(segunda.status).toBe("RECUSADO");
    expect(segunda.mpPaymentId).toBe(primeira.mpPaymentId);

    const linhas = await prisma.subscriptionPayment.count({
      where: { tenantId, mpPaymentId: gw.nextCardId },
    });
    expect(linhas).toBe(1);
  });
});

describe("Estorno com webhook perdido", () => {
  it("a reconciliação diária reverte um pagamento APROVADO que virou estorno", async () => {
    const tenantId = await novoCliente();
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    const mpId = `estorno-${uniq()}`;
    gw.status.set(mpId, "approved");

    const refMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const periodStart = new Date("2026-08-01T00:00:00Z");
    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        tenantId,
        amount: 29.9,
        status: "APROVADO",
        method: "PIX",
        referenceMonth: refMonth,
        mpPaymentId: mpId,
        paidAt: new Date(),
        periodStart,
        periodEnd: new Date("2026-09-01T00:00:00Z"),
      },
    });
    await prisma.tenantSubscription.update({
      where: { id: sub.id },
      data: {
        status: "ATIVO",
        activatedAt: new Date(),
        currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      },
    });

    // O titular pede o estorno e o webhook nunca chega.
    gw.status.set(mpId, "refunded");
    const resultado = await BillingService.reconcilePendingPayments();
    expect(resultado.atualizados).toBeGreaterThanOrEqual(1);

    const pagamento = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { mpPaymentId: mpId },
    });
    expect(pagamento.status).toBe("ESTORNADO");

    const depois = await prisma.tenantSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(depois.status).toBe("SUSPENSO");
    expect(depois.statusSource).toBe("MANUAL"); // trava o recálculo do cron
    expect(depois.currentPeriodEnd.toISOString()).toBe(periodStart.toISOString());
  });

  it("chargeback bloqueia a conta (mais grave que estorno)", async () => {
    const tenantId = await novoCliente();
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    const mpId = `chargeback-${uniq()}`;
    gw.status.set(mpId, "approved");

    const refMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        tenantId,
        amount: 29.9,
        status: "APROVADO",
        method: "CREDIT_CARD",
        referenceMonth: refMonth,
        mpPaymentId: mpId,
        paidAt: new Date(),
        periodStart: new Date("2026-08-01T00:00:00Z"),
        periodEnd: new Date("2026-09-01T00:00:00Z"),
      },
    });
    await prisma.tenantSubscription.update({
      where: { id: sub.id },
      data: { status: "ATIVO", activatedAt: new Date() },
    });

    gw.status.set(mpId, "charged_back");
    await BillingService.handleWebhook(mpId);

    const depois = await prisma.tenantSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(depois.status).toBe("BLOQUEADO");
  });
});
