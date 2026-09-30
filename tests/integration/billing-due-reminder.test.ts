import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import { BillingService, DUE_REMINDER_DAYS } from "@/lib/services/billing.service";

/**
 * Só o ENVIO é substituído (o resto do módulo de e-mail, inclusive o template,
 * é o real): sem SMTP o envio já era no-op, e aqui ele também registra o que
 * sairia — assunto e corpo — para conferir valor e prazo do texto.
 */
const mail = vi.hoisted(() => ({ enviar: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/email")>();
  return { ...orig, sendEmail: mail.enviar };
});

beforeEach(() => {
  mail.enviar.mockReset();
  mail.enviar.mockResolvedValue({ ok: true, id: "teste" });
});

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

/**
 * Valor, prazo e dedupe do lembrete.
 *
 * Datas fixas longe de hoje: o cron recebe `now`, e fixar os dois lados é o que
 * torna a contagem de dias determinística (a hora do dia muda o resultado).
 */
describe("Lembrete — valor cobrado, dias de calendário e reserva da marca", () => {
  let planoNovoId = "";

  beforeAll(async () => {
    const p = await prisma.plan.create({
      data: { name: "Plano Novo", slug: `lembrete-novo-${uniq()}`, priceMonthly: 19.9, active: true },
    });
    planoNovoId = p.id;
  });

  afterAll(async () => {
    await prisma.tenantSubscription.updateMany({
      where: { pendingPlanId: planoNovoId },
      data: { pendingPlanId: null, pendingPlanFrom: null },
    });
    await prisma.plan.delete({ where: { id: planoNovoId } }).catch(() => {});
  });

  async function comVencimento(
    currentPeriodEnd: Date,
    extra: { pendingPlanId?: string; pendingPlanFrom?: Date } = {},
  ) {
    const tenantId = await createTestTenant("LEMBRETE FIXO");
    tenants.push(tenantId);
    const email = `lembrete-fixo-${uniq()}@t.com`;
    const sub = await prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId,
        status: "ATIVO",
        monthlyAmount: 49.9,
        activatedAt: new Date("2026-01-10T00:00:00Z"),
        currentPeriodEnd,
        graceDays: 5,
        ...extra,
      },
    });
    await prisma.user.create({
      data: { tenantId, name: "Dono", email, passwordHash: "x", role: "OWNER" },
    });
    return { tenantId, subId: sub.id, email };
  }

  const enviadosPara = (email: string) =>
    mail.enviar.mock.calls.filter((c) => c[0] === email) as [string, string, string][];

  it("com troca de plano agendada, o e-mail informa o valor que será cobrado", async () => {
    const venc = new Date("2027-03-12T21:00:00.000Z");
    const { tenantId, email } = await comVencimento(venc, {
      pendingPlanId: planoNovoId,
      pendingPlanFrom: venc,
    });

    await BillingService.enviarLembretesDeVencimento(new Date("2027-03-10T16:30:00.000Z"));

    const [envio] = enviadosPara(email);
    expect(envio).toBeDefined();
    // O valor do plano NOVO (o que `prepareCharge` cobra), não o do vigente.
    expect(envio![2]).toContain("19,90");
    expect(envio![2]).not.toContain("49,90");
    const marca = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: "SUBSCRIPTION_DUE_REMINDER" },
    });
    expect((marca.newData as { amount: string }).amount).toBe("19.9");
  });

  it("conta dias de calendário: 13:30 de 10/03 → 18:00 de 12/03 são 2 dias", async () => {
    const { email } = await comVencimento(new Date("2027-04-12T21:00:00.000Z"));

    await BillingService.enviarLembretesDeVencimento(new Date("2027-04-10T16:30:00.000Z"));

    const [envio] = enviadosPara(email);
    expect(envio![1]).toContain("vence em 2 dias");
  });

  it("entra na janela no 3º dia de calendário antes, e não repete no dia seguinte", async () => {
    // Vence 12/05 às 23:00 (BRT). Na rodada de 09/05 13:30 faltam 3,4 dias em
    // horas corridas — a janela de 72h deixava de fora, e o aviso saía com 2
    // dias de antecedência.
    const { tenantId, email } = await comVencimento(new Date("2027-05-13T02:00:00.000Z"));

    await BillingService.enviarLembretesDeVencimento(new Date("2027-05-09T16:30:00.000Z"));
    expect(enviadosPara(email)[0]![1]).toContain("vence em 3 dias");

    await BillingService.enviarLembretesDeVencimento(new Date("2027-05-10T16:30:00.000Z"));
    expect(enviadosPara(email)).toHaveLength(1);
    expect(await lembretesGravados(tenantId)).toBe(1);
  });

  it("execuções sobrepostas do cron mandam UM e-mail", async () => {
    const { tenantId, email } = await comVencimento(new Date("2027-06-12T21:00:00.000Z"));
    const now = new Date("2027-06-10T16:30:00.000Z");

    await Promise.all([
      BillingService.enviarLembretesDeVencimento(now),
      BillingService.enviarLembretesDeVencimento(now),
      BillingService.enviarLembretesDeVencimento(now),
    ]);

    expect(enviadosPara(email)).toHaveLength(1);
    expect(await lembretesGravados(tenantId)).toBe(1);
  });

  it("falha no envio libera a reserva: o cron seguinte tenta de novo", async () => {
    const { tenantId, email } = await comVencimento(new Date("2027-07-12T21:00:00.000Z"));
    mail.enviar.mockImplementation(async (to: string) =>
      to === email ? { ok: false, error: "smtp fora" } : { ok: true, id: "x" },
    );

    await BillingService.enviarLembretesDeVencimento(new Date("2027-07-10T16:30:00.000Z"));
    expect(await lembretesGravados(tenantId)).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { tenantId, action: "SUBSCRIPTION_DUE_REMINDER_FAILED" },
      }),
    ).toBe(1);

    mail.enviar.mockResolvedValue({ ok: true, id: "x" });
    await BillingService.enviarLembretesDeVencimento(new Date("2027-07-11T16:30:00.000Z"));
    expect(await lembretesGravados(tenantId)).toBe(1);
  });
});
