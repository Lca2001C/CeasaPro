import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";
import { refMonthTz } from "@/lib/tz";
import { addOneMonth } from "@/lib/billing/status";

/**
 * Pendências de cobrança das auditorias de 23/09 e 30/09:
 *
 *  1. o cron de billing estourava os 60 s na reconciliação (sequencial, sem
 *     prazo, sem rotação);
 *  2. o QR substituído só era cancelado no nosso banco — pagável por 48 h no
 *     gateway —, e o pagamento aprovado que não creditava sumia no log;
 *  3. o lembrete "vence em 3 dias" levava a "a mensalidade deste mês já está
 *     paga";
 *  4. o bloqueio de chargeback desfeito por pagamento não avisava ninguém;
 *  5. quem cancelou não trocava de plano ao voltar;
 *  7. `reativarAssinatura` gravava fora de transação;
 *  8. `valorDevido` cobrava o preço de plano agendado já inativo.
 *
 * O Mercado Pago é um fake com estado: status, valor e cancelamento por id.
 */

const gw = vi.hoisted(() => ({
  status: new Map<string, string>(),
  valores: new Map<string, number>(),
  porChave: new Map<string, string>(),
  tenantDe: new Map<string, string>(),
  chamadas: 0,
  cancelados: [] as string[],
  falharCancel: false,
  consultas: [] as string[],
  atrasoMs: 0,
  emVoo: 0,
  maxEmVoo: 0,
  emVooPorEmpresa: new Map<string, number>(),
  maxEmVooMesmaEmpresa: 0,
  proximoCartao: { id: "", status: "approved" },
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
        expiresAt: Date;
        idempotencySalt?: string;
      }) => {
        // Mesma chave que o serviço manda ao gateway (com o sal, quando há).
        const chave =
          `pix:${args.externalReference}:${args.amount.toFixed(2)}` +
          (args.idempotencySalt ? `:${args.idempotencySalt}` : "");
        let id = gw.porChave.get(chave);
        if (!id) {
          gw.chamadas += 1;
          id = `mp-pend-${gw.chamadas}-${Math.random().toString(36).slice(2, 6)}`;
          gw.porChave.set(chave, id);
          gw.status.set(id, "pending");
        }
        gw.valores.set(id, args.amount);
        return {
          mpPaymentId: id,
          status: gw.status.get(id) ?? "pending",
          qrCode: `QR-${id}`,
          qrCodeBase64: "aW1n",
          ticketUrl: null,
          expiresAt: args.expiresAt,
        };
      },
    ),
    createCardPayment: vi.fn(async (args: { amount: number }) => {
      const { id, status } = gw.proximoCartao;
      gw.status.set(id, status);
      gw.valores.set(id, args.amount);
      return { mpPaymentId: id, status, statusDetail: status, threeDs: null };
    }),
    getPayment: vi.fn(async (id: string) => {
      const status = gw.status.get(id);
      if (!status) throw new Error(`pagamento fora deste teste: ${id}`);
      gw.consultas.push(id);
      const empresa = gw.tenantDe.get(id) ?? "?";
      gw.emVoo++;
      gw.maxEmVoo = Math.max(gw.maxEmVoo, gw.emVoo);
      const naEmpresa = (gw.emVooPorEmpresa.get(empresa) ?? 0) + 1;
      gw.emVooPorEmpresa.set(empresa, naEmpresa);
      gw.maxEmVooMesmaEmpresa = Math.max(gw.maxEmVooMesmaEmpresa, naEmpresa);
      try {
        if (gw.atrasoMs) await new Promise((r) => setTimeout(r, gw.atrasoMs));
        return {
          id,
          status,
          statusDetail: status,
          externalReference: null,
          amount: gw.valores.get(id) ?? 0,
          method: "pix",
          paymentTypeId: "bank_transfer",
          paidAt: status === "approved" ? new Date() : null,
        };
      } finally {
        gw.emVoo--;
        gw.emVooPorEmpresa.set(empresa, (gw.emVooPorEmpresa.get(empresa) ?? 1) - 1);
      }
    }),
    cancelPayment: vi.fn(async (id: string) => {
      gw.cancelados.push(id);
      if (gw.falharCancel) throw new Error("gateway fora do ar");
      const atual = gw.status.get(id);
      // Aprovado não se cancela: o gateway devolve o status real.
      if (atual === "approved") return { id, status: "approved" };
      gw.status.set(id, "cancelled");
      return { id, status: "cancelled" };
    }),
  };
});

import { BillingService, competenciaACobrar, valorDevido } from "@/lib/services/billing.service";
import { PlanoService } from "@/lib/services/plano.service";
import { BusinessRuleError } from "@/lib/http/app-error";

const uniq = () => Math.random().toString(36).slice(2, 8);
const DIA = 24 * 60 * 60 * 1000;
const daquiA = (dias: number) => new Date(Date.now() + dias * DIA);
const tenants: string[] = [];
let basico = "";
let completo = "";

function mesSeguinte(ref: string): string {
  const [a, m] = ref.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

async function empresa(opts: {
  status?: "ATIVO" | "SUSPENSO" | "BLOQUEADO" | "VENCIDO";
  statusSource?: "AUTO" | "MANUAL";
  statusReason?: string | null;
  activatedAt?: Date | null;
  currentPeriodEnd?: Date;
  cancelledAt?: Date | null;
  planId?: string;
  monthlyAmount?: number;
}) {
  const tenantId = await createTestTenant(`PENDENCIAS ${uniq()}`);
  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: opts.planId ?? basico,
      status: opts.status ?? "SUSPENSO",
      statusSource: opts.statusSource ?? "AUTO",
      statusReason: opts.statusReason ?? null,
      monthlyAmount: opts.monthlyAmount ?? 49.9,
      activatedAt: opts.activatedAt === undefined ? null : opts.activatedAt,
      currentPeriodEnd: opts.currentPeriodEnd ?? new Date("2026-01-01T00:00:00Z"),
      cancelledAt: opts.cancelledAt ?? null,
      graceDays: 5,
    },
  });
  await prisma.user.create({
    data: {
      tenantId,
      name: "Dono Pendências",
      email: `pend-${uniq()}@t.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  tenants.push(tenantId);
  return { tenantId, subId: sub.id, ctx: makeCtx(tenantId) };
}

/** Linha de cobrança direto no banco, com o status correspondente no fake. */
async function cobranca(
  e: { tenantId: string; subId: string },
  opts: {
    status: "PENDENTE" | "APROVADO" | "CANCELADO";
    mpStatus: string;
    referenceMonth?: string;
    amount?: number;
    createdAt?: Date;
    lastReconciledAt?: Date | null;
    expiresAt?: Date | null;
  },
) {
  const mpPaymentId = `mp-pend-${uniq()}-${uniq()}`;
  const referenceMonth = opts.referenceMonth ?? refMonthTz(new Date());
  gw.status.set(mpPaymentId, opts.mpStatus);
  gw.valores.set(mpPaymentId, opts.amount ?? 49.9);
  gw.tenantDe.set(mpPaymentId, e.tenantId);
  const row = await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: e.subId,
      tenantId: e.tenantId,
      amount: opts.amount ?? 49.9,
      status: opts.status,
      method: "PIX",
      referenceMonth,
      mpPaymentId,
      approvedKey: opts.status === "APROVADO" ? `${e.tenantId}:${referenceMonth}` : null,
      paidAt: opts.status === "APROVADO" ? new Date() : null,
      createdAt: opts.createdAt ?? new Date(Date.now() - 60 * 60 * 1000),
      lastReconciledAt: opts.lastReconciledAt ?? null,
      expiresAt: opts.expiresAt === undefined ? daquiA(1) : opts.expiresAt,
    },
  });
  return { ...row, mpPaymentId };
}

async function avisos(tenantId: string, kind: "PAGAMENTO_NAO_CREDITADO" | "BLOQUEIO_DESFEITO_POR_PAGAMENTO") {
  return prisma.adminNotification.count({ where: { tenantId, kind } });
}

beforeAll(async () => {
  const b = await prisma.plan.create({
    data: { name: "Básico Pend", slug: `bas-pend-${uniq()}`, priceMonthly: 49.9, active: true },
  });
  const c = await prisma.plan.create({
    data: { name: "Completo Pend", slug: `com-pend-${uniq()}`, priceMonthly: 99.9, active: true },
  });
  basico = b.id;
  completo = c.id;
});

beforeEach(() => {
  gw.cancelados = [];
  gw.falharCancel = false;
  gw.consultas = [];
  gw.atrasoMs = 0;
  gw.maxEmVoo = 0;
  gw.maxEmVooMesmaEmpresa = 0;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.deleteMany({ where: { id: { in: [basico, completo] } } });
});

// ---------------------------------------------------------------------------
// 1. Reconciliação: prazo, concorrência, rotação
// ---------------------------------------------------------------------------

describe("Reconciliação com orçamento de tempo", () => {
  it("com o orçamento esgotado não consulta nada e diz quantas ficaram", async () => {
    const e = await empresa({});
    await cobranca(e, { status: "PENDENTE", mpStatus: "approved" });

    const r = await BillingService.reconcilePendingPayments({ orcamentoMs: 0 });

    expect(r.esgotouTempo).toBe(true);
    expect(r.verificados).toBe(0);
    expect(r.naoVerificados).toBeGreaterThanOrEqual(1);
    // Nada foi aplicado: a pendente continua pendente para a próxima rodada.
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.status).toBe("SUSPENSO");
  });

  it("rotação: nunca conferidas primeiro, depois as conferidas há mais tempo", async () => {
    const ontem = daquiA(-1);
    const anteontem = daquiA(-2);
    const a = await empresa({ status: "ATIVO", activatedAt: daquiA(-20), currentPeriodEnd: daquiA(10) });
    const b = await empresa({ status: "ATIVO", activatedAt: daquiA(-20), currentPeriodEnd: daquiA(10) });
    const c = await empresa({ status: "ATIVO", activatedAt: daquiA(-20), currentPeriodEnd: daquiA(10) });
    const conferidaOntem = await cobranca(a, { status: "APROVADO", mpStatus: "approved", lastReconciledAt: ontem });
    const nunca = await cobranca(b, { status: "APROVADO", mpStatus: "approved" });
    const conferidaAnteontem = await cobranca(c, {
      status: "APROVADO",
      mpStatus: "approved",
      lastReconciledAt: anteontem,
    });

    await BillingService.reconcilePendingPayments({ concorrencia: 1 });

    const nossas = [conferidaOntem.mpPaymentId, nunca.mpPaymentId, conferidaAnteontem.mpPaymentId];
    const ordem = gw.consultas.filter((id) => nossas.includes(id));
    expect(ordem).toEqual([nunca.mpPaymentId, conferidaAnteontem.mpPaymentId, conferidaOntem.mpPaymentId]);

    // E a marca avança: amanhã estas três vão para o fim da fila.
    const depois = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: nunca.id } });
    expect(depois.lastReconciledAt).not.toBeNull();
  });

  it("marca a conferência mesmo quando a consulta falha (não entope a cabeça da fila)", async () => {
    const e = await empresa({});
    const linha = await cobranca(e, { status: "PENDENTE", mpStatus: "pending" });
    gw.status.delete(linha.mpPaymentId); // o fake passa a falhar para este id

    await BillingService.reconcilePendingPayments();

    const depois = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: linha.id } });
    expect(depois.lastReconciledAt).not.toBeNull();
    expect(depois.status).toBe("PENDENTE");
  });

  it("concorrência limitada, e nunca duas cobranças da mesma empresa ao mesmo tempo", async () => {
    gw.atrasoMs = 15;
    const mesmas = await empresa({ status: "ATIVO", activatedAt: daquiA(-20), currentPeriodEnd: daquiA(10) });
    // Duas da mesma empresa: uma aprovada (varredura de estorno) e uma cancelada.
    await cobranca(mesmas, { status: "APROVADO", mpStatus: "approved" });
    await cobranca(mesmas, { status: "CANCELADO", mpStatus: "cancelled" });
    for (let i = 0; i < 12; i++) {
      const e = await empresa({ status: "ATIVO", activatedAt: daquiA(-20), currentPeriodEnd: daquiA(10) });
      await cobranca(e, { status: "APROVADO", mpStatus: "approved" });
    }

    const r = await BillingService.reconcilePendingPayments();

    expect(r.esgotouTempo).toBe(false);
    expect(gw.maxEmVoo).toBeGreaterThan(1);
    expect(gw.maxEmVoo).toBeLessThanOrEqual(6);
    expect(gw.maxEmVooMesmaEmpresa).toBe(1);
  });

  it("alcança a competência SEGUINTE (renovação paga adiantada)", async () => {
    const e = await empresa({ status: "ATIVO", activatedAt: daquiA(-28), currentPeriodEnd: daquiA(2) });
    const proxima = mesSeguinte(refMonthTz(new Date()));
    const linha = await cobranca(e, { status: "PENDENTE", mpStatus: "approved", referenceMonth: proxima });

    await BillingService.reconcilePendingPayments();

    const depois = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: linha.id } });
    expect(depois.status).toBe("APROVADO");
  });
});

// ---------------------------------------------------------------------------
// 2. Cancelamento no gateway e o aprovado que não credita
// ---------------------------------------------------------------------------

describe("QR substituído sai de circulação no Mercado Pago", () => {
  it("trocar de plano cancela o QR antigo no gateway", async () => {
    const { tenantId, ctx } = await empresa({});
    const velho = await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx);
    const novo = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: completo },
      ctx,
    );

    expect(novo.mpPaymentId).not.toBe(velho.mpPaymentId);
    expect(gw.cancelados).toContain(velho.mpPaymentId);
    expect(gw.status.get(velho.mpPaymentId!)).toBe("cancelled");
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: velho.id } });
    expect(linha.status).toBe("CANCELADO");
  });

  it("voltar ao plano de antes não reapresenta o QR cancelado no gateway", async () => {
    // A idempotência do MP é por referência + valor: o código de 49,90 pedido
    // de novo voltaria o MESMO pagamento — cancelado lá. A tela mostraria um
    // código que o banco recusa.
    const { tenantId, ctx } = await empresa({});
    const primeiro = await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx);
    await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true, planId: completo }, ctx);
    const deVolta = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: basico },
      ctx,
    );

    expect(deVolta.mpPaymentId).not.toBe(primeiro.mpPaymentId);
    expect(deVolta.status).toBe("PENDENTE");
    expect(gw.status.get(deVolta.mpPaymentId!)).toBe("pending");
  });

  it("cartão aprovado cancela o PIX também no gateway", async () => {
    const { tenantId, ctx } = await empresa({});
    const pix = await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx);
    gw.proximoCartao = { id: `card-${uniq()}`, status: "approved" };

    await BillingService.processCardPayment(
      tenantId,
      {
        method: "CREDIT_CARD",
        token: "tok",
        paymentMethodId: "visa",
        installments: 1,
        payer: { email: "p@t.com" },
        acceptedTerms: true,
      },
      ctx,
    );

    expect(gw.cancelados).toContain(pix.mpPaymentId);
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: pix.id } });
    expect(linha.status).toBe("CANCELADO");
  });

  it("cartão RECUSADO não mata o PIX (a empresa segue com uma forma de pagar)", async () => {
    const { tenantId, ctx } = await empresa({});
    const pix = await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx);
    gw.proximoCartao = { id: `card-${uniq()}`, status: "rejected" };

    const r = await BillingService.processCardPayment(
      tenantId,
      {
        method: "CREDIT_CARD",
        token: "tok-recusado",
        paymentMethodId: "visa",
        installments: 1,
        payer: { email: "p@t.com" },
        acceptedTerms: true,
      },
      ctx,
    );

    expect(r.status).toBe("RECUSADO");
    expect(gw.cancelados).not.toContain(pix.mpPaymentId);
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: pix.id } });
    expect(linha.status).toBe("PENDENTE");
  });

  it("cancelar a assinatura cancela o QR em aberto no gateway", async () => {
    const e = await empresa({ status: "ATIVO", activatedAt: daquiA(-10), currentPeriodEnd: daquiA(20) });
    const aberta = await cobranca(e, {
      status: "PENDENTE",
      mpStatus: "pending",
      referenceMonth: mesSeguinte(refMonthTz(new Date())),
    });

    await BillingService.cancelarAssinatura(e.ctx);

    expect(gw.cancelados).toContain(aberta.mpPaymentId);
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: aberta.id } });
    expect(linha.status).toBe("CANCELADO");
  });

  it("falha do gateway no cancelamento não impede a troca de plano", async () => {
    gw.falharCancel = true;
    const { tenantId, ctx } = await empresa({});
    const velho = await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx);
    const novo = await BillingService.createCheckout(
      tenantId,
      { method: "PIX", acceptedTerms: true, planId: completo },
      ctx,
    );
    expect(Number(novo.amount)).toBe(99.9);
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: velho.id } });
    expect(linha.status).toBe("CANCELADO");
  });
});

describe("Cancelada no banco, viva no gateway", () => {
  it("a reconciliação NÃO reabre e tenta cancelar de novo", async () => {
    const e = await empresa({});
    const linha = await cobranca(e, { status: "CANCELADO", mpStatus: "pending" });

    await BillingService.reconcilePendingPayments();

    const depois = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: linha.id } });
    expect(depois.status).toBe("CANCELADO");
    expect(gw.cancelados).toContain(linha.mpPaymentId);
    expect(gw.status.get(linha.mpPaymentId)).toBe("cancelled");
  });

  it("paga mesmo assim, pelo valor devido: a reconciliação credita", async () => {
    const e = await empresa({});
    const linha = await cobranca(e, { status: "CANCELADO", mpStatus: "approved", amount: 49.9 });

    await BillingService.reconcilePendingPayments();

    const depois = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: linha.id } });
    expect(depois.status).toBe("APROVADO");
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.status).toBe("ATIVO");
    expect(await avisos(e.tenantId, "PAGAMENTO_NAO_CREDITADO")).toBe(0);
  });
});

describe("Aprovado e NÃO creditado vira aviso ao super-admin", () => {
  it("valor a menor (QR antigo pago depois da troca): sem crédito, um aviso só", async () => {
    gw.falharCancel = true; // o cancelamento no gateway não pegou
    const { tenantId, ctx } = await empresa({});
    const velho = await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true }, ctx);
    await BillingService.createCheckout(tenantId, { method: "PIX", acceptedTerms: true, planId: completo }, ctx);
    gw.status.set(velho.mpPaymentId!, "approved");
    gw.tenantDe.set(velho.mpPaymentId!, tenantId);

    await BillingService.reconcilePendingPayments();
    await BillingService.reconcilePendingPayments();
    await BillingService.handleWebhook(velho.mpPaymentId!);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.activatedAt).toBeNull();
    expect(sub.status).toBe("SUSPENSO");
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: velho.id } });
    expect(linha.status).not.toBe("APROVADO");
    expect(linha.uncreditedReason).toBe("VALOR_MENOR");
    expect(linha.uncreditedAt).not.toBeNull();
    expect(await avisos(tenantId, "PAGAMENTO_NAO_CREDITADO")).toBe(1);
    const aviso = await prisma.adminNotification.findFirstOrThrow({
      where: { tenantId, kind: "PAGAMENTO_NAO_CREDITADO" },
    });
    expect(aviso.body).toContain("49.90");
    expect(aviso.body).toContain("99.90");
  });

  it("segunda aprovação da competência: sem crédito dobrado, um aviso só", async () => {
    const e = await empresa({});
    const primeira = await cobranca(e, { status: "PENDENTE", mpStatus: "approved" });
    await BillingService.handleWebhook(primeira.mpPaymentId);
    const pago = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(pago.status).toBe("ATIVO");

    // Uma segunda cobrança do mesmo mês (criada antes da aprovação, por
    // exemplo) é paga também.
    const segunda = await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: e.subId,
        tenantId: e.tenantId,
        amount: 49.9,
        status: "PENDENTE",
        method: "PIX",
        referenceMonth: primeira.referenceMonth,
        mpPaymentId: `mp-pend-dup-${uniq()}`,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    gw.status.set(segunda.mpPaymentId!, "approved");
    gw.valores.set(segunda.mpPaymentId!, 49.9);

    expect(await BillingService.handleWebhook(segunda.mpPaymentId!)).toBe("ignorado");
    await BillingService.reconcilePendingPayments();
    await BillingService.handleWebhook(segunda.mpPaymentId!);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.currentPeriodEnd.toISOString()).toBe(pago.currentPeriodEnd.toISOString());
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: segunda.id } });
    expect(linha.status).toBe("CANCELADO"); // sai da tela como cobrança em aberto
    expect(linha.uncreditedReason).toBe("DUPLICADO");
    expect(await avisos(e.tenantId, "PAGAMENTO_NAO_CREDITADO")).toBe(1);
  });

  it("aprovar a competência baixa as outras cobranças abertas dela, aqui e no gateway", async () => {
    const e = await empresa({});
    const paga = await cobranca(e, { status: "PENDENTE", mpStatus: "approved" });
    const outra = await cobranca(e, { status: "PENDENTE", mpStatus: "pending" });

    await BillingService.handleWebhook(paga.mpPaymentId);

    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: outra.id } });
    expect(linha.status).toBe("CANCELADO");
    expect(gw.cancelados).toContain(outra.mpPaymentId);
  });
});

// ---------------------------------------------------------------------------
// 3. Renovação adiantada dentro da janela do lembrete
// ---------------------------------------------------------------------------

/** Empresa em dia, com a competência do calendário paga e vencimento em `dias`. */
async function pagantePerto(dias: number, opts?: { cpe?: Date; agora?: Date }) {
  const agora = opts?.agora ?? new Date();
  const cpe = opts?.cpe ?? new Date(agora.getTime() + dias * DIA);
  const e = await empresa({
    status: "ATIVO",
    activatedAt: new Date(agora.getTime() - 60 * DIA),
    currentPeriodEnd: cpe,
  });
  const corrente = refMonthTz(agora);
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: e.subId,
      tenantId: e.tenantId,
      amount: 49.9,
      status: "APROVADO",
      method: "PIX",
      referenceMonth: corrente,
      mpPaymentId: `mp-pend-mes-${uniq()}`,
      approvedKey: `${e.tenantId}:${corrente}`,
      paidAt: new Date(agora.getTime() - 25 * DIA),
      periodStart: addOneMonth(new Date(cpe.getTime() - 31 * DIA)),
      periodEnd: cpe,
    },
  });
  return { ...e, cpe, corrente };
}

describe("competenciaACobrar (datas fixas)", () => {
  it("vencimento no dia 1º, lembrete no dia 28: cobra o mês seguinte", async () => {
    const agora = new Date("2026-09-28T15:00:00Z");
    const e = await pagantePerto(0, { agora, cpe: new Date("2026-10-01T15:00:00Z") });
    const alvo = await competenciaACobrar(e.tenantId, { activatedAt: agora, currentPeriodEnd: e.cpe }, agora);
    expect(alvo).toMatchObject({ refMonth: "2026-10", antecipada: true, paga: null });
  });

  it("vencimento no fim do PRÓPRIO mês pago: pula para o seguinte, sem colidir", async () => {
    const agora = new Date("2026-09-27T15:00:00Z");
    const e = await pagantePerto(0, { agora, cpe: new Date("2026-09-30T20:00:00Z") });
    const alvo = await competenciaACobrar(e.tenantId, { activatedAt: agora, currentPeriodEnd: e.cpe }, agora);
    expect(alvo.refMonth).toBe("2026-10");
    expect(alvo.paga).toBeNull();
  });

  it("fora da janela: mês pago é mês pago", async () => {
    const agora = new Date("2026-09-20T15:00:00Z");
    const e = await pagantePerto(0, { agora, cpe: new Date("2026-10-01T15:00:00Z") });
    const alvo = await competenciaACobrar(e.tenantId, { activatedAt: agora, currentPeriodEnd: e.cpe }, agora);
    expect(alvo.refMonth).toBe("2026-09");
    expect(alvo.antecipada).toBe(false);
    expect(alvo.paga).not.toBeNull();
  });

  it("a janela é a do lembrete, por dia de calendário (3 dias)", async () => {
    const cpe = new Date("2026-10-01T23:00:00Z"); // 01/10 20:00 BRT
    const e = await pagantePerto(0, { agora: new Date("2026-09-28T15:00:00Z"), cpe });
    const sub = { activatedAt: new Date("2026-01-01T00:00:00Z"), currentPeriodEnd: cpe };
    // 28/09 é D-3: dentro. 27/09 é D-4: fora.
    expect((await competenciaACobrar(e.tenantId, sub, new Date("2026-09-28T03:30:00Z"))).antecipada).toBe(true);
    expect((await competenciaACobrar(e.tenantId, sub, new Date("2026-09-27T23:00:00Z"))).antecipada).toBe(false);
  });
});

describe("Pagar a renovação adiantada", () => {
  it("dentro da janela, a tela oferece o pagamento e a cobrança é da competência seguinte", async () => {
    const e = await pagantePerto(2);
    const status = await BillingService.getStatus(e.tenantId);
    const esperado =
      refMonthTz(e.cpe) > e.corrente ? refMonthTz(e.cpe) : mesSeguinte(e.corrente);
    expect(status?.paidCharge).toBeNull();
    expect(status?.refMonth).toBe(esperado);

    const c = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    expect(c.referenceMonth).toBe(esperado);
    expect(Number(c.amount)).toBe(49.9);
  });

  it("fora da janela, continua recusando com MENSALIDADE_JA_PAGA", async () => {
    const e = await pagantePerto(10);
    await expect(
      BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx),
    ).rejects.toMatchObject({ code: "MENSALIDADE_JA_PAGA" });
    const status = await BillingService.getStatus(e.tenantId);
    expect(status?.refMonth).toBe(e.corrente);
    expect(status?.paidCharge).not.toBeNull();
  });

  it("aprovada, estende a partir do vencimento — e só uma vez", async () => {
    const e = await pagantePerto(2);
    const c = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    gw.status.set(c.mpPaymentId!, "approved");
    expect(await BillingService.handleWebhook(c.mpPaymentId!)).toBe("aplicado");

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    // Adiantar não encurta nem alonga: o mês novo começa no vencimento antigo.
    expect(sub.currentPeriodEnd.toISOString()).toBe(addOneMonth(e.cpe).toISOString());
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: c.id } });
    expect(linha.periodStart?.toISOString()).toBe(e.cpe.toISOString());

    // Com o vencimento um mês à frente, saiu da janela: não dá para pagar de novo.
    await expect(
      BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx),
    ).rejects.toMatchObject({ code: "MENSALIDADE_JA_PAGA" });

    // Um segundo pagamento da MESMA competência adiantada esbarra na chave.
    const dup = await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: e.subId,
        tenantId: e.tenantId,
        amount: 49.9,
        status: "PENDENTE",
        method: "PIX",
        referenceMonth: c.referenceMonth,
        mpPaymentId: `mp-pend-dup2-${uniq()}`,
      },
    });
    gw.status.set(dup.mpPaymentId!, "approved");
    gw.valores.set(dup.mpPaymentId!, 49.9);
    expect(await BillingService.handleWebhook(dup.mpPaymentId!)).toBe("ignorado");
    const depois = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(depois.currentPeriodEnd.toISOString()).toBe(sub.currentPeriodEnd.toISOString());
  });

  it("com troca de plano agendada para o vencimento, a renovação adiantada sai pelo plano novo", async () => {
    const e = await pagantePerto(2);
    const r = await PlanoService.changePlan(completo, e.ctx);
    expect(r.scheduled).toBe(true);
    const c = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    expect(Number(c.amount)).toBe(99.9);
  });

  it("agendar a troca DEPOIS de gerar o QR adiantado baixa o QR do preço antigo", async () => {
    const e = await pagantePerto(2);
    const c = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    expect(Number(c.amount)).toBe(49.9);

    await PlanoService.changePlan(completo, e.ctx);

    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: c.id } });
    expect(linha.status).toBe("CANCELADO");
    expect(gw.cancelados).toContain(c.mpPaymentId);
  });

  it("estorno do mês adiantado devolve só esse mês", async () => {
    const e = await pagantePerto(2);
    const c = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    gw.status.set(c.mpPaymentId!, "approved");
    await BillingService.handleWebhook(c.mpPaymentId!);

    gw.status.set(c.mpPaymentId!, "refunded");
    await BillingService.handleWebhook(c.mpPaymentId!);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.currentPeriodEnd.toISOString()).toBe(e.cpe.toISOString());
    expect(sub.status).toBe("SUSPENSO");
  });
});

// ---------------------------------------------------------------------------
// 4. Bloqueio manual desfeito por pagamento
// ---------------------------------------------------------------------------

describe("Pagamento que desfaz bloqueio manual", () => {
  it("chargeback BLOQUEADO + pagamento novo: volta a ATIVO e avisa o super-admin", async () => {
    const e = await empresa({
      status: "BLOQUEADO",
      statusSource: "MANUAL",
      statusReason: "Pagamento charged_back no Mercado Pago (123)",
      activatedAt: daquiA(-40),
      currentPeriodEnd: daquiA(-5),
    });
    const c = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    gw.status.set(c.mpPaymentId!, "approved");
    await BillingService.handleWebhook(c.mpPaymentId!);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.status).toBe("ATIVO");
    expect(sub.statusSource).toBe("AUTO");
    expect(await avisos(e.tenantId, "BLOQUEIO_DESFEITO_POR_PAGAMENTO")).toBe(1);
    const aviso = await prisma.adminNotification.findFirstOrThrow({
      where: { tenantId: e.tenantId, kind: "BLOQUEIO_DESFEITO_POR_PAGAMENTO" },
    });
    expect(aviso.body).toContain("charged_back");
    const rastro = await prisma.auditLog.count({
      where: { tenantId: e.tenantId, action: "STATUS_CHANGE", entity: "TenantSubscription" },
    });
    expect(rastro).toBe(1);
  });

  it("SUSPENSO por estorno + pagamento novo: reativa sem aviso (é o caminho normal)", async () => {
    const e = await empresa({
      status: "SUSPENSO",
      statusSource: "MANUAL",
      statusReason: "Pagamento refunded no Mercado Pago (456)",
      activatedAt: daquiA(-40),
      currentPeriodEnd: daquiA(-5),
    });
    const c = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
    gw.status.set(c.mpPaymentId!, "approved");
    await BillingService.handleWebhook(c.mpPaymentId!);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.status).toBe("ATIVO");
    expect(await avisos(e.tenantId, "BLOQUEIO_DESFEITO_POR_PAGAMENTO")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Cancelado troca de plano ao recontratar
// ---------------------------------------------------------------------------

describe("Troca de plano de assinatura cancelada", () => {
  it("período pago ENCERRADO: troca na hora, e o pagamento sai pelo plano escolhido", async () => {
    const e = await empresa({
      status: "SUSPENSO",
      activatedAt: daquiA(-60),
      currentPeriodEnd: daquiA(-2),
      cancelledAt: daquiA(-20),
    });
    const c = await BillingService.createCheckout(
      e.tenantId,
      { method: "PIX", acceptedTerms: true, planId: completo },
      e.ctx,
    );
    expect(Number(c.amount)).toBe(99.9);
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.planId).toBe(completo);
    expect(sub.pendingPlanId).toBeNull();

    gw.status.set(c.mpPaymentId!, "approved");
    await BillingService.handleWebhook(c.mpPaymentId!);
    const pago = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(pago.cancelledAt).toBeNull();
    expect(pago.status).toBe("ATIVO");
  });

  it("período pago AINDA correndo: continua recusando", async () => {
    const e = await empresa({
      status: "ATIVO",
      activatedAt: daquiA(-20),
      currentPeriodEnd: daquiA(10),
      cancelledAt: daquiA(-1),
    });
    await expect(PlanoService.changePlan(completo, e.ctx)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

// ---------------------------------------------------------------------------
// 7. reativarAssinatura em transação
// ---------------------------------------------------------------------------

describe("reativarAssinatura", () => {
  it("reativa e grava o rastro", async () => {
    const e = await empresa({
      status: "ATIVO",
      activatedAt: daquiA(-20),
      currentPeriodEnd: daquiA(10),
      cancelledAt: daquiA(-1),
    });
    const r = await BillingService.reativarAssinatura(e.ctx);
    expect(r.status).toBe("ATIVO");
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.cancelledAt).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { tenantId: e.tenantId, action: "STATUS_CHANGE" } }),
    ).toBe(1);
  });

  it("falha no rastro desfaz a reativação (mesma transação)", async () => {
    const e = await empresa({
      status: "ATIVO",
      activatedAt: daquiA(-20),
      currentPeriodEnd: daquiA(10),
      cancelledAt: daquiA(-1),
    });
    // Força a gravação da auditoria a falhar: o Postgres recusa o byte NUL em
    // texto. Dentro da transação a falha propaga e desfaz a reativação; fora
    // dela (como era), a assinatura ficava reativada sem rastro.
    const ctx = { ...e.ctx, session: { ...e.ctx.session, email: "dono\u0000@t.com" } };
    await expect(BillingService.reativarAssinatura(ctx)).rejects.toBeTruthy();

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
    expect(sub.cancelledAt).not.toBeNull();
    expect(
      await prisma.auditLog.count({ where: { tenantId: e.tenantId, action: "STATUS_CHANGE" } }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Plano agendado inativo
// ---------------------------------------------------------------------------

describe("Troca agendada para plano que saiu de oferta", () => {
  it("valorDevido cobra o plano vigente", () => {
    const sub = {
      monthlyAmount: 49.9 as unknown as import("@/lib/money").Decimal,
      currentPeriodEnd: daquiA(2),
      pendingPlanFrom: daquiA(2),
      pendingPlan: { priceMonthly: 99.9 as unknown as import("@/lib/money").Decimal, active: false },
    };
    expect(valorDevido(sub, new Date()).toString()).toBe("49.9");
    expect(valorDevido({ ...sub, pendingPlan: { ...sub.pendingPlan, active: true } }, new Date()).toString()).toBe(
      "99.9",
    );
  });

  it("a cobrança sai pelo plano vigente e o agendamento é descartado na hora, com rastro", async () => {
    const inativo = await prisma.plan.create({
      data: { name: "Fora de oferta", slug: `fora-${uniq()}`, priceMonthly: 149.9, active: false },
    });
    try {
      const e = await pagantePerto(2);
      await prisma.tenantSubscription.update({
        where: { tenantId: e.tenantId },
        data: { pendingPlanId: inativo.id, pendingPlanFrom: e.cpe },
      });

      const c = await BillingService.createCheckout(e.tenantId, { method: "PIX", acceptedTerms: true }, e.ctx);
      expect(Number(c.amount)).toBe(49.9);

      const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } });
      expect(sub.pendingPlanId).toBeNull();
      expect(sub.planId).toBe(basico);
      const rastro = await prisma.auditLog.count({
        where: { tenantId: e.tenantId, entity: "TenantSubscription", action: "UPDATE" },
      });
      expect(rastro).toBeGreaterThanOrEqual(1);

      const view = await PlanoService.getPlanoView(e.tenantId);
      expect(view?.pendingPlan).toBeNull();
    } finally {
      await prisma.tenantSubscription.updateMany({
        where: { pendingPlanId: inativo.id },
        data: { pendingPlanId: null, pendingPlanFrom: null },
      });
      await prisma.plan.delete({ where: { id: inativo.id } }).catch(() => {});
    }
  });
});
