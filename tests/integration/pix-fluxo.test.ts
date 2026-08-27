import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import type { TenantCtx } from "@/lib/http/with-action";

/**
 * Fluxo PIX de ponta a ponta: gerar cobrança → pagar → liberar acesso.
 *
 * O gateway é mockado, mas o mock imita o comportamento REAL que quebrava o
 * fluxo: a **idempotência** do Mercado Pago, que devolve a mesma cobrança para
 * a mesma chave. É daí que vinham os estados travados.
 */
const gw = vi.hoisted(() => ({
  chamadas: 0,
  /** Chave de idempotência → cobrança devolvida, como o MP faz. */
  porChave: new Map<string, string>(),
  ultimoPayload: null as Record<string, unknown> | null,
  status: new Map<string, string>(),
}));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    createPixPayment: vi.fn(
      async (args: {
        amount: number;
        externalReference: string;
        payerEmail: string;
        payerName?: string | null;
        payerIdentification?: { type: string; number: string } | null;
        expiresAt: Date;
      }) => {
        gw.ultimoPayload = { ...args };
        // Mesma chave que o serviço usa: referência externa + valor.
        const chave = `pix:${args.externalReference}:${args.amount.toFixed(2)}`;
        let id = gw.porChave.get(chave);
        if (!id) {
          gw.chamadas += 1;
          id = `mp-pix-${gw.chamadas}`;
          gw.porChave.set(chave, id);
          gw.status.set(id, "pending");
        }
        return {
          mpPaymentId: id,
          status: gw.status.get(id) ?? "pending",
          qrCode: `00020126580014BR.GOV.BCB.PIX-${id}`,
          qrCodeBase64: "aW1hZ2VtLXBuZw==",
          ticketUrl: `https://mp.fake/${id}`,
          expiresAt: args.expiresAt,
        };
      },
    ),
    getPayment: vi.fn(async (id: string) => {
      const status = gw.status.get(id) ?? "pending";
      return {
        id,
        status,
        statusDetail: status,
        externalReference: null,
        amount: 0,
        method: "pix",
        paymentTypeId: "bank_transfer",
        paidAt: status === "approved" ? new Date() : null,
      };
    }),
    verifyWebhookSignature: () => true,
  };
});

import { BillingService } from "@/lib/services/billing.service";
import { temPagamentoPix } from "@/lib/payments/pix-charge";

const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
let planoBasico = "";
let planoCompleto = "";

/** Empresa nova: suspensa, nunca pagou. */
async function novoCliente(): Promise<{ tenantId: string; ctx: TenantCtx }> {
  const tenantId = await createTestTenant("PIX FLUXO");
  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: planoBasico,
      status: "SUSPENSO",
      monthlyAmount: 49.9,
      activatedAt: null,
      currentPeriodEnd: new Date("2026-01-01T00:00:00Z"),
      graceDays: 5,
    },
  });
  await prisma.user.create({
    data: {
      tenantId,
      name: "Maria da Silva",
      email: `dono-${uniq()}@t.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  tenants.push(tenantId);
  return { tenantId, ctx: makeCtx(tenantId) };
}

beforeAll(async () => {
  const b = await prisma.plan.create({
    data: { name: "Básico PIX", slug: `bas-pix-${uniq()}`, priceMonthly: 49.9, active: true },
  });
  const c = await prisma.plan.create({
    data: { name: "Completo PIX", slug: `com-pix-${uniq()}`, priceMonthly: 99.9, active: true },
  });
  planoBasico = b.id;
  planoCompleto = c.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.deleteMany({ where: { id: { in: [planoBasico, planoCompleto] } } });
});

describe("Gerar cobrança PIX", () => {
  it("devolve algo pagável: QR, copia-e-cola e validade", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    expect(cobranca.status).toBe("PENDENTE");
    expect(cobranca.method).toBe("PIX");
    expect(cobranca.qrCode).toContain("BR.GOV.BCB.PIX");
    expect(cobranca.qrCodeBase64).toBeTruthy();
    expect(cobranca.expiresAt).toBeTruthy();
    // É o que a tela usa para decidir se mostra o painel de pagamento.
    expect(temPagamentoPix({ ...cobranca, amount: cobranca.amount.toString() })).toBe(true);
  });

  it("manda ao Mercado Pago os dados que a API exige do pagador", async () => {
    const { tenantId, ctx } = await novoCliente();
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { cnpj: "12345678000199" },
    });
    await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx);

    const payload = gw.ultimoPayload!;
    expect(payload.payerEmail).toMatch(/@/);
    expect(payload.payerName).toBe("Maria da Silva");
    expect(payload.payerIdentification).toEqual({ type: "CNPJ", number: "12345678000199" });
    // Validade no futuro — o MP recusa cobrança já vencida.
    expect((payload.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("é idempotente no mês: segunda chamada devolve a MESMA cobrança", async () => {
    const { tenantId, ctx } = await novoCliente();
    const a = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    const b = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    expect(b.id).toBe(a.id);
    const quantas = await prisma.subscriptionPayment.count({
      where: { tenantId, status: "PENDENTE" },
    });
    expect(quantas).toBe(1);
  });

  it("cobrança vencida é substituída por uma NOVA, utilizável", async () => {
    const { tenantId, ctx } = await novoCliente();
    const antiga = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    // Vence a cobrança e a chave de idempotência do MP (24h no mundo real).
    await prisma.subscriptionPayment.update({
      where: { id: antiga.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    gw.porChave.clear();

    const nova = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    expect(nova.id).not.toBe(antiga.id);
    expect(nova.status).toBe("PENDENTE");
    expect(nova.qrCode).toBeTruthy();
    expect(
      (await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: antiga.id } })).status,
    ).toBe("CANCELADO");
  });

  it("regenerar quando o MP devolve a MESMA cobrança não deixa o registro CANCELADO", async () => {
    // Era o bug: cancelávamos a linha e o `upsert` a atualizava sem voltar o
    // status. Ficava um QR válido na tela ligado a uma cobrança CANCELADA, e o
    // polling — que procura PENDENTE — nunca confirmava o pagamento.
    const { tenantId, ctx } = await novoCliente();
    const primeira = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    await prisma.subscriptionPayment.update({
      where: { id: primeira.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    // NÃO limpa `gw.porChave`: o MP devolve a mesma cobrança (idempotência viva).

    const segunda = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    expect(segunda.id).toBe(primeira.id);
    expect(segunda.status).toBe("PENDENTE");
    expect(segunda.qrCode).toBeTruthy();

    // E a tela de status precisa enxergar essa cobrança.
    const status = await BillingService.getStatus(tenantId);
    expect(status?.pendingCharge?.id).toBe(segunda.id);
  });

  it("não reabre cobrança já paga", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    gw.status.set(cobranca.mpPaymentId!, "approved");
    await BillingService.handleWebhook(cobranca.mpPaymentId!);

    // Mês já pago: o serviço recusa nova cobrança antes mesmo de chamar o MP.
    await expect(
      BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx),
    ).rejects.toThrow(/já está paga/i);
  });
});

describe("Troca de plano no PIX", () => {
  it("gera QR novo com o valor do plano escolhido", async () => {
    const { tenantId, ctx } = await novoCliente();
    const basico = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    expect(Number(basico.amount)).toBe(49.9);

    const completo = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: planoCompleto },
      ctx,
    );

    // Pagar 49,90 e receber o plano de 99,90 seria prejuízo silencioso.
    expect(completo.id).not.toBe(basico.id);
    expect(Number(completo.amount)).toBe(99.9);
    expect(gw.ultimoPayload!.amount).toBe(99.9);
  });
});

describe("Pagamento confirmado pelo webhook", () => {
  it("ativa a assinatura, avança o vencimento e libera o acesso", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );

    gw.status.set(cobranca.mpPaymentId!, "approved");
    const r = await BillingService.handleWebhook(cobranca.mpPaymentId!);
    expect(r).toBe("aplicado");

    const paga = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: cobranca.id },
    });
    expect(paga.status).toBe("APROVADO");
    expect(paga.paidAt).toBeTruthy();

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("ATIVO");
    expect(sub.activatedAt).toBeTruthy();
    // Empresa que nunca pagou tem vencimento no passado: o ciclo recomeça hoje,
    // senão o mês recém-pago já nasceria vencido.
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());

    // É isto que o polling da tela consulta para liberar o acesso.
    const status = await BillingService.getStatus(tenantId);
    expect(Boolean(status?.paidCharge)).toBe(true);
  });

  it("reentrega do mesmo webhook não avança o vencimento de novo", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    gw.status.set(cobranca.mpPaymentId!, "approved");
    await BillingService.handleWebhook(cobranca.mpPaymentId!);

    const antes = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    const r = await BillingService.handleWebhook(cobranca.mpPaymentId!);
    const depois = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });

    expect(r).toBe("ignorado");
    expect(depois.currentPeriodEnd.toISOString()).toBe(antes.currentPeriodEnd.toISOString());
  });

  it("webhook perdido é curado pela reconciliação do cron", async () => {
    const { tenantId, ctx } = await novoCliente();
    const cobranca = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true },
      ctx,
    );
    // Pagou no banco, mas a notificação nunca chegou.
    gw.status.set(cobranca.mpPaymentId!, "approved");
    await prisma.subscriptionPayment.update({
      where: { id: cobranca.id },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    await BillingService.reconcilePendingPayments();

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("ATIVO");
  });
});
