import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import { BillingService, DUE_REMINDER_DAYS } from "@/lib/services/billing.service";

/**
 * Lembrete de vencimento. Sem SMTP configurado o envio é no-op e devolve
 * `{ ok: true }`, então o que se observa aqui é a decisão de QUEM recebe e a
 * marca de auditoria que impede o reenvio — que é onde estão as regras.
 */
const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
let planId = "";

const dias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function assinatura(opts: {
  vencimentoEmDias: number;
  status?: "ATIVO" | "SUSPENSO" | "VENCIDO";
  ativada?: boolean;
  comOwner?: boolean;
}): Promise<{ tenantId: string; subId: string }> {
  const tenantId = await createTestTenant("LEMBRETE");
  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: opts.status ?? "ATIVO",
      monthlyAmount: 49.9,
      activatedAt: (opts.ativada ?? true) ? new Date("2026-01-10T00:00:00Z") : null,
      currentPeriodEnd: dias(opts.vencimentoEmDias),
      graceDays: 5,
    },
  });
  if (opts.comOwner ?? true) {
    await prisma.user.create({
      data: {
        tenantId,
        name: "Dono Lembrete",
        email: `lembrete-${uniq()}@t.com`,
        passwordHash: "x",
        role: "OWNER",
      },
    });
  }
  tenants.push(tenantId);
  return { tenantId, subId: sub.id };
}

async function lembretesGravados(tenantId: string): Promise<number> {
  return prisma.auditLog.count({
    where: { tenantId, action: "SUBSCRIPTION_DUE_REMINDER" },
  });
}

beforeAll(async () => {
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Lembrete",
      slug: `lembrete-${uniq()}`,
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

describe("Lembrete de vencimento (cron diário)", () => {
  it(`avisa quem vence dentro de ${DUE_REMINDER_DAYS} dias`, async () => {
    const { tenantId } = await assinatura({ vencimentoEmDias: 2 });

    const r = await BillingService.enviarLembretesDeVencimento();
    expect(r.enviados).toBeGreaterThanOrEqual(1);
    expect(await lembretesGravados(tenantId)).toBe(1);
  });

  it("não repete o aviso nas rodadas seguintes do mesmo período", async () => {
    const { tenantId } = await assinatura({ vencimentoEmDias: 1 });

    await BillingService.enviarLembretesDeVencimento();
    // O cron roda todo dia; sem a marca de auditoria, o cliente receberia o
    // mesmo e-mail três dias seguidos.
    await BillingService.enviarLembretesDeVencimento();
    await BillingService.enviarLembretesDeVencimento();

    expect(await lembretesGravados(tenantId)).toBe(1);
  });

  it("volta a avisar no período seguinte (vencimento novo)", async () => {
    const { tenantId, subId } = await assinatura({ vencimentoEmDias: 2 });
    await BillingService.enviarLembretesDeVencimento();
    expect(await lembretesGravados(tenantId)).toBe(1);

    // Pagou: o vencimento avança um mês. Depois de ~30 dias, ele volta a
    // entrar na janela — e o aviso do período anterior não pode calá-lo.
    await prisma.tenantSubscription.update({
      where: { id: subId },
      data: { currentPeriodEnd: dias(32) },
    });
    await prisma.auditLog.updateMany({
      where: { tenantId, action: "SUBSCRIPTION_DUE_REMINDER" },
      data: { createdAt: dias(-30) },
    });
    await prisma.tenantSubscription.update({
      where: { id: subId },
      data: { currentPeriodEnd: dias(2) },
    });

    await BillingService.enviarLembretesDeVencimento();
    expect(await lembretesGravados(tenantId)).toBe(2);
  });

  it("não avisa quem ainda está longe do vencimento", async () => {
    const { tenantId } = await assinatura({ vencimentoEmDias: 15 });
    await BillingService.enviarLembretesDeVencimento();
    expect(await lembretesGravados(tenantId)).toBe(0);
  });

  it("não avisa quem nunca pagou (já vê a cobrança ao entrar)", async () => {
    const { tenantId } = await assinatura({
      vencimentoEmDias: 2,
      status: "SUSPENSO",
      ativada: false,
    });
    await BillingService.enviarLembretesDeVencimento();
    expect(await lembretesGravados(tenantId)).toBe(0);
  });

  it("não avisa quem já venceu (o bloqueio é o aviso)", async () => {
    const { tenantId } = await assinatura({ vencimentoEmDias: -1, status: "VENCIDO" });
    await BillingService.enviarLembretesDeVencimento();
    expect(await lembretesGravados(tenantId)).toBe(0);
  });

  it("empresa sem OWNER não gera marca (não há para quem escrever)", async () => {
    const { tenantId } = await assinatura({ vencimentoEmDias: 2, comOwner: false });
    await BillingService.enviarLembretesDeVencimento();
    expect(await lembretesGravados(tenantId)).toBe(0);
  });
});
