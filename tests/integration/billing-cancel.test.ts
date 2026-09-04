import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { BillingService } from "@/lib/services/billing.service";
import { PlanoService } from "@/lib/services/plano.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import { BusinessRuleError } from "@/lib/http/app-error";

let tenantId = "";
let trialTenantId = "";
let planId = "";
let outroPlanId = "";

const uniq = () => Math.random().toString(36).slice(2, 8);
const daquiA = (dias: number) => new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  tenantId = await createTestTenant("CANCEL ASSINATURA");
  trialTenantId = await createTestTenant("CANCEL TRIAL");

  const plano = await prisma.plan.create({
    data: {
      name: "Plano Cancel Teste",
      slug: `cancel-${uniq()}`,
      priceMonthly: 49.9,
      active: true,
    },
  });
  const outro = await prisma.plan.create({
    data: {
      name: "Plano Cancel Outro",
      slug: `cancel-outro-${uniq()}`,
      priceMonthly: 79.9,
      active: true,
    },
  });
  planId = plano.id;
  outroPlanId = outro.id;

  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: "ATIVO",
      monthlyAmount: 49.9,
      activatedAt: daquiA(-20),
      currentPeriodEnd: daquiA(12),
      graceDays: 5,
    },
  });
  await prisma.user.create({
    data: {
      tenantId,
      name: "Dono Cancel",
      email: `cancel-${uniq()}@t.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });

  await prisma.tenantSubscription.create({
    data: {
      tenantId: trialTenantId,
      planId,
      status: "TRIAL",
      monthlyAmount: 49.9,
      activatedAt: null,
      trialEndsAt: daquiA(5),
      currentPeriodEnd: daquiA(-1),
      graceDays: 5,
    },
  });
});

afterAll(async () => {
  await cleanupTenants([tenantId, trialTenantId]);
  await prisma.plan.deleteMany({ where: { id: { in: [planId, outroPlanId] } } });
});

describe("Cancelar assinatura (OWNER)", () => {
  it("no período pago mantém o acesso até o vencimento e baixa cobrança aberta", async () => {
    const cobranca = await prisma.subscriptionPayment.create({
      data: {
        tenantId,
        subscriptionId: (await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } }))
          .id,
        amount: 49.9,
        status: "PENDENTE",
        method: "PIX",
        referenceMonth: "2099-01",
      },
    });

    const r = await BillingService.cancelarAssinatura(makeCtx(tenantId));
    expect(r.status).toBe("ATIVO");
    expect(r.accessUntil).toBeTruthy();

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.cancelledAt).not.toBeNull();
    expect(sub.status).toBe("ATIVO");

    const pix = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: cobranca.id } });
    expect(pix.status).toBe("CANCELADO");
  });

  it("desfazer no período pago limpa cancelledAt", async () => {
    const r = await BillingService.reativarAssinatura(makeCtx(tenantId));
    expect(r.status).toBe("ATIVO");
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.cancelledAt).toBeNull();
  });

  it("trocar de plano é recusado enquanto estiver cancelada", async () => {
    await BillingService.cancelarAssinatura(makeCtx(tenantId));
    await expect(PlanoService.changePlan(outroPlanId, makeCtx(tenantId))).rejects.toThrow(
      BusinessRuleError,
    );
    await BillingService.reativarAssinatura(makeCtx(tenantId));
  });

  it("não cancela duas vezes", async () => {
    await BillingService.cancelarAssinatura(makeCtx(tenantId));
    await expect(BillingService.cancelarAssinatura(makeCtx(tenantId))).rejects.toThrow(
      /já está cancelada/i,
    );
    await BillingService.reativarAssinatura(makeCtx(tenantId));
  });

  it("no teste grátis encerra na hora", async () => {
    const r = await BillingService.cancelarAssinatura(makeCtx(trialTenantId));
    expect(r.status).toBe("CANCELADO");
    expect(r.accessUntil).toBeNull();
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { tenantId: trialTenantId },
    });
    expect(sub.status).toBe("CANCELADO");
    expect(sub.cancelledAt).not.toBeNull();
  });
});
