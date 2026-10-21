import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import { refMonthTz } from "@/lib/tz";
import type { OptionalModuleKey } from "@/lib/plan/modules";
import type { MpPayment } from "@/lib/payments/mercadopago";

/**
 * Na tolerância (período vencido, acesso ainda liberado) a troca de plano vale
 * na hora — é ela que decide o valor da cobrança. Os MÓDULOS, não: valem só os
 * que o último período pago comprou e que o plano de agora tem. Subir de plano
 * não libera nada até o pagamento aprovar; descer tira na hora.
 */

const gw = vi.hoisted(() => ({ chamadas: 0 }));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    createPixPayment: vi.fn(async (args: { expiresAt: Date }) => {
      gw.chamadas += 1;
      const id = `mp-tol-${gw.chamadas}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        mpPaymentId: id,
        status: "pending",
        qrCode: `QR-${id}`,
        qrCodeBase64: "aW1n",
        ticketUrl: null,
        expiresAt: args.expiresAt,
      };
    }),
    cancelPayment: vi.fn(async (id: string) => ({ id, status: "cancelled" })),
  };
});

import { BillingService } from "@/lib/services/billing.service";
import { PlanoService } from "@/lib/services/plano.service";
import { buildAccessPayload } from "@/lib/auth/build-session";

const uniq = () => Math.random().toString(36).slice(2, 8);
const DIA = 24 * 60 * 60 * 1000;
const daquiA = (dias: number) => new Date(Date.now() + dias * DIA);
const tenants: string[] = [];
const planIds: string[] = [];

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
});

async function plano(priceMonthly: number, modules: OptionalModuleKey[]) {
  const p = await prisma.plan.create({
    data: {
      name: `Plano ${uniq()}`,
      slug: `tol-${uniq()}-${uniq()}`,
      priceMonthly,
      active: true,
      features: { modules },
    },
  });
  planIds.push(p.id);
  return p;
}

/**
 * Empresa que pagou o mês anterior (com os módulos gravados no pagamento) e
 * venceu ontem: está na tolerância. `trial`: nunca pagou.
 */
async function empresa(
  p: { id: string; priceMonthly: unknown; features: unknown },
  modo: "vencida" | "trial",
) {
  const tenantId = await createTestTenant("PLANO TOLERANCIA");
  tenants.push(tenantId);
  const monthlyAmount = Number(p.priceMonthly);
  const currentPeriodEnd = modo === "vencida" ? daquiA(-1) : daquiA(5);
  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: p.id,
      status: modo === "vencida" ? "VENCIDO" : "TRIAL",
      monthlyAmount,
      activatedAt: modo === "vencida" ? daquiA(-31) : null,
      trialEndsAt: modo === "trial" ? daquiA(5) : null,
      currentPeriodEnd,
      graceDays: 5,
    },
  });
  const owner = await prisma.user.create({
    data: {
      tenantId,
      name: "Dono",
      email: `tol-${uniq()}@teste-ceasapro.com.br`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  if (modo === "vencida") {
    const referenceMonth = refMonthTz(daquiA(-31));
    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        tenantId,
        amount: monthlyAmount,
        status: "APROVADO",
        method: "PIX",
        referenceMonth,
        mpPaymentId: `tol-pago-${uniq()}`,
        approvedKey: `${tenantId}:${referenceMonth}`,
        paidAt: daquiA(-31),
        periodStart: daquiA(-31),
        periodEnd: currentPeriodEnd,
        features: p.features as object,
      },
    });
  }
  return { tenantId, ownerId: owner.id, ctx: makeCtx(tenantId, owner.id) };
}

function mp(id: string, amount: number): MpPayment {
  return {
    id,
    status: "approved",
    statusDetail: "accredited",
    externalReference: null,
    amount,
    method: "pix",
    paymentTypeId: "bank_transfer",
    paidAt: new Date(),
  } as MpPayment;
}

const modulos = async (ownerId: string) => (await buildAccessPayload(ownerId))?.modules ?? [];

describe("Módulos na tolerância", () => {
  it("subir de plano vencido não libera módulo novo antes de pagar; pagando, libera", async () => {
    const basico = await plano(29.9, ["caixas"]);
    const completo = await plano(99.9, ["caixas", "cotacoes"]);
    const e = await empresa(basico, "vencida");

    const troca = await PlanoService.changePlan(completo.id, e.ctx);
    expect(troca.scheduled).toBe(false);
    expect(await modulos(e.ownerId)).toEqual(["caixas"]);

    const qr = await BillingService.createCheckout(
      e.tenantId,
      { method: "PIX", acceptedTerms: true },
      e.ctx,
    );
    expect(Number(qr.amount)).toBe(99.9);
    // Gerar a cobrança do plano caro também não libera nada.
    expect(await modulos(e.ownerId)).toEqual(["caixas"]);

    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: qr.id } });
    expect(await BillingService.applyPaymentStatus(mp(linha.mpPaymentId!, 99.9))).toBe("aplicado");
    expect(await modulos(e.ownerId)).toEqual(expect.arrayContaining(["caixas", "cotacoes"]));
  });

  it("descer de plano vencido tira os módulos na hora", async () => {
    const completo = await plano(99.9, ["caixas", "cotacoes"]);
    const basico = await plano(29.9, ["caixas"]);
    const e = await empresa(completo, "vencida");
    expect(await modulos(e.ownerId)).toEqual(expect.arrayContaining(["caixas", "cotacoes"]));

    const troca = await PlanoService.changePlan(basico.id, e.ctx);
    expect(troca.scheduled).toBe(false);
    expect(await modulos(e.ownerId)).toEqual(["caixas"]);
  });

  it("trial segue o catálogo vivo", async () => {
    const completo = await plano(99.9, ["caixas", "cotacoes"]);
    const e = await empresa(completo, "trial");
    expect(await modulos(e.ownerId)).toEqual(expect.arrayContaining(["caixas", "cotacoes"]));
  });
});
