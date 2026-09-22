import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import { createRefreshToken, rotateRefreshToken } from "@/lib/auth/refresh";
import { refMonthTz } from "@/lib/tz";

/**
 * Uma competência, um crédito.
 *
 * Duas falhas simétricas da auditoria viviam na mesma ausência de trava:
 *
 *  1. **Dois pagamentos aprovados no mesmo mês creditavam o mês duas vezes.**
 *     `applyPaymentStatus` soma um mês a partir de `currentPeriodEnd`, então a
 *     segunda aprovação de agosto comprava setembro sem cobrança. Acontece sem
 *     má-fé: o PIX quitado minutos depois de o cartão ter passado, o mesmo QR
 *     pago duas vezes, o suporte gerando uma segunda via.
 *
 *  2. **Estornar UMA cobrança suspendia a empresa mesmo com a outra paga.** A
 *     reversão não olhava se sobrava pagamento válido da competência — e como ela
 *     grava `statusSource: MANUAL`, que trava o recálculo do cron, só um humano
 *     no painel devolvia o acesso de quem estava em dia.
 */

const gw = vi.hoisted(() => ({
  /** mpPaymentId -> status corrente no "Mercado Pago". */
  status: new Map<string, string>(),
}));

vi.mock("@/lib/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoConfigured: () => true,
    assertMercadoPagoConfig: vi.fn(),
    getPayment: vi.fn(async (id: string) => {
      const status = gw.status.get(id);
      // Id de outro arquivo de teste rodando na mesma base: falhar é o certo —
      // o laço da reconciliação pula a linha em vez de inventar um status.
      if (!status) throw new Error(`pagamento fora deste teste: ${id}`);
      return {
        id,
        status,
        statusDetail: status === "approved" ? "accredited" : status,
        externalReference: null,
        amount: 49.9,
        method: "pix",
        paymentTypeId: "bank_transfer",
        paidAt: status === "approved" ? new Date() : null,
      };
    }),
  };
});

import { BillingService } from "@/lib/services/billing.service";
import { accessDecision } from "@/lib/billing/status";

const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
let planId = "";

/** Empresa ATIVA com um mês pago em aberto e uma sessão viva. */
async function empresaComSessao(): Promise<{
  tenantId: string;
  subscriptionId: string;
  refreshToken: string;
  refMonth: string;
}> {
  const tenantId = await createTestTenant("UMA APROVACAO POR MES");
  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: "ATIVO",
      monthlyAmount: 49.9,
      activatedAt: new Date(),
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      graceDays: 5,
    },
  });
  const owner = await prisma.user.create({
    data: {
      tenantId,
      name: "Dono",
      email: `competencia-${uniq()}@teste-ceasapro.com.br`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  tenants.push(tenantId);
  return {
    tenantId,
    subscriptionId: sub.id,
    refreshToken: await createRefreshToken(owner.id),
    refMonth: refMonthTz(new Date()),
  };
}

/** Cobrança PENDENTE da competência corrente, pronta para virar aprovada. */
async function cobrancaPendente(ctx: {
  tenantId: string;
  subscriptionId: string;
  refMonth: string;
}): Promise<string> {
  const mpPaymentId = `mp-comp-${uniq()}`;
  gw.status.set(mpPaymentId, "pending");
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: ctx.subscriptionId,
      tenantId: ctx.tenantId,
      amount: 49.9,
      status: "PENDENTE",
      method: "PIX",
      referenceMonth: ctx.refMonth,
      mpPaymentId,
    },
  });
  return mpPaymentId;
}

beforeAll(async () => {
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Competência",
      slug: `competencia-${Date.now()}`,
      priceMonthly: 49.9,
      active: true,
      features: { modules: [] },
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
});

describe("Segunda aprovação na mesma competência", () => {
  it("não credita o mês de novo — o vencimento anda uma vez só", async () => {
    const ctx = await empresaComSessao();
    const primeiro = await cobrancaPendente(ctx);
    const segundo = await cobrancaPendente(ctx);

    gw.status.set(primeiro, "approved");
    expect(await BillingService.handleWebhook(primeiro)).toBe("aplicado");
    const aposPrimeiro = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: ctx.subscriptionId },
    });

    // O segundo PIX do mesmo mês cai — e é o caso comum, não o exótico: basta o
    // cliente pagar o QR antigo que ainda estava no app do banco.
    gw.status.set(segundo, "approved");
    expect(await BillingService.handleWebhook(segundo)).toBe("ignorado");

    const aposSegundo = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: ctx.subscriptionId },
    });
    expect(aposSegundo.currentPeriodEnd.toISOString()).toBe(
      aposPrimeiro.currentPeriodEnd.toISOString(),
    );

    // A segunda linha fica como estava: o dinheiro entrou no Mercado Pago e o
    // registro tem de continuar auditável para quem for devolver.
    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { mpPaymentId: segundo },
    });
    expect(linha.status).toBe("PENDENTE");
    expect(linha.approvedKey).toBeNull();
  });

  it("a cobrança aprovada carrega a chave da competência", async () => {
    const ctx = await empresaComSessao();
    const mpId = await cobrancaPendente(ctx);
    gw.status.set(mpId, "approved");
    await BillingService.handleWebhook(mpId);

    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { mpPaymentId: mpId },
    });
    expect(linha.approvedKey).toBe(`${ctx.tenantId}:${ctx.refMonth}`);
  });

  it("o banco recusa a duplicidade mesmo por escrita direta", async () => {
    // A checagem do serviço protege o caminho do webhook; o índice único protege
    // TODOS os caminhos — script de correção, importação, corrida entre dois
    // webhooks que atravessem o `findFirst` no mesmo instante.
    const ctx = await empresaComSessao();
    const mpId = await cobrancaPendente(ctx);
    gw.status.set(mpId, "approved");
    await BillingService.handleWebhook(mpId);

    await expect(
      prisma.subscriptionPayment.create({
        data: {
          subscriptionId: ctx.subscriptionId,
          tenantId: ctx.tenantId,
          amount: 49.9,
          status: "APROVADO",
          method: "PIX",
          referenceMonth: ctx.refMonth,
          mpPaymentId: `mp-forcado-${uniq()}`,
          approvedKey: `${ctx.tenantId}:${ctx.refMonth}`,
        },
      }),
    ).rejects.toThrow(/Unique constraint|approvedKey/i);
  });

  it("competências diferentes continuam livres", async () => {
    const ctx = await empresaComSessao();
    const mpId = await cobrancaPendente(ctx);
    gw.status.set(mpId, "approved");
    await BillingService.handleWebhook(mpId);

    // O mês seguinte é outra competência: a trava é por mês, não por empresa.
    const outroMes = await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: ctx.subscriptionId,
        tenantId: ctx.tenantId,
        amount: 49.9,
        status: "APROVADO",
        method: "PIX",
        referenceMonth: "2999-12",
        mpPaymentId: `mp-outro-mes-${uniq()}`,
        approvedKey: `${ctx.tenantId}:2999-12`,
      },
    });
    expect(outroMes.id).toBeTruthy();
  });

  it("recusada e estornada podem se repetir à vontade no mesmo mês", async () => {
    // Quem tenta três cartões até um passar gera três linhas RECUSADAS do mesmo
    // mês. Vários NULL não colidem em índice único — e é isso que mantém o
    // caminho normal de "tentar de novo" funcionando.
    const ctx = await empresaComSessao();
    for (let i = 0; i < 3; i++) {
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: ctx.subscriptionId,
          tenantId: ctx.tenantId,
          amount: 49.9,
          status: "RECUSADO",
          method: "CREDIT_CARD",
          referenceMonth: ctx.refMonth,
          mpPaymentId: `mp-recusado-${i}-${uniq()}`,
        },
      });
    }
    const recusadas = await prisma.subscriptionPayment.count({
      where: { tenantId: ctx.tenantId, referenceMonth: ctx.refMonth, status: "RECUSADO" },
    });
    expect(recusadas).toBe(3);
  });
});

describe("Reversão quando a competência segue paga por outra cobrança", () => {
  /**
   * O cenário real: o cliente paga no cartão, contesta (ou pede estorno) e, no
   * meio disso, quita um PIX que o suporte gerou. Estornado o cartão, o mês
   * continua pago — e cortar o acesso aqui é bloquear quem está em dia.
   */
  async function cartaoEstornadoComPixValido() {
    const ctx = await empresaComSessao();
    const cartao = await cobrancaPendente(ctx);
    gw.status.set(cartao, "approved");
    await BillingService.handleWebhook(cartao);

    // O PIX entra como aprovado por fora do webhook (foi conciliado à mão), e é
    // por isso que ele NÃO carrega a chave: quem a tem é o cartão, até cair.
    const pix = await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: ctx.subscriptionId,
        tenantId: ctx.tenantId,
        amount: 49.9,
        status: "APROVADO",
        method: "PIX",
        referenceMonth: ctx.refMonth,
        mpPaymentId: `mp-pix-valido-${uniq()}`,
        paidAt: new Date(),
      },
    });
    return { ctx, cartao, pix };
  }

  it("mantém o acesso, o vencimento e a origem AUTO", async () => {
    const { ctx, cartao } = await cartaoEstornadoComPixValido();
    const antes = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: ctx.subscriptionId },
    });

    gw.status.set(cartao, "refunded");
    expect(await BillingService.handleWebhook(cartao)).toBe("aplicado");

    const depois = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: ctx.subscriptionId },
    });
    expect(depois.status).toBe("ATIVO");
    expect(depois.currentPeriodEnd.toISOString()).toBe(antes.currentPeriodEnd.toISOString());
    // MANUAL travaria o cron e exigiria um humano para devolver o acesso.
    expect(depois.statusSource).toBe("AUTO");
    expect(accessDecision("ACTIVE", depois.status)).toBe("ok");
  });

  it("a cobrança estornada muda de status e solta a chave da competência", async () => {
    const { ctx, cartao } = await cartaoEstornadoComPixValido();
    gw.status.set(cartao, "refunded");
    await BillingService.handleWebhook(cartao);

    const linha = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { mpPaymentId: cartao },
    });
    expect(linha.status).toBe("ESTORNADO");
    expect(linha.approvedKey).toBeNull();
    void ctx;
  });

  it("não derruba as sessões abertas", async () => {
    const { ctx, cartao } = await cartaoEstornadoComPixValido();
    gw.status.set(cartao, "refunded");
    await BillingService.handleWebhook(cartao);

    const rotacao = await rotateRefreshToken(ctx.refreshToken);
    expect(rotacao.tipo).not.toBe("invalido");
  });

  it("não grava ACCESS_REVOKED — grava o pagamento com acesso mantido", async () => {
    const { ctx, cartao } = await cartaoEstornadoComPixValido();
    gw.status.set(cartao, "refunded");
    await BillingService.handleWebhook(cartao);

    const revogacoes = await prisma.auditLog.count({
      where: { tenantId: ctx.tenantId, action: "ACCESS_REVOKED" },
    });
    expect(revogacoes).toBe(0);

    // Os dois registros de PAYMENT saem na MESMA transação, com o mesmo
    // `createdAt` — ordenar por data aqui escolheria um deles no sorteio. O que
    // importa é que o registro do acesso mantido exista.
    const registros = await prisma.auditLog.findMany({
      where: { tenantId: ctx.tenantId, entity: "SubscriptionPayment", action: "PAYMENT" },
    });
    const mantido = registros.find(
      (r) => (r.newData as { acessoMantido?: boolean } | null)?.acessoMantido === true,
    );
    expect(mantido, "falta o registro de reversão com acesso mantido").toBeDefined();
    expect(mantido!.newData).toMatchObject({ mpStatus: "refunded", acessoMantido: true });
  });

  it("chargeback com outro pagamento válido também não bloqueia", async () => {
    // Chargeback é mais grave que estorno e BLOQUEIA a conta — mas a gravidade é
    // sobre a cobrança contestada, não sobre uma competência que segue paga.
    const { ctx, cartao } = await cartaoEstornadoComPixValido();
    gw.status.set(cartao, "charged_back");
    await BillingService.handleWebhook(cartao);

    const depois = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: ctx.subscriptionId },
    });
    expect(depois.status).toBe("ATIVO");
  });

  it("sem outro pagamento válido, a reversão bloqueia como sempre bloqueou", async () => {
    // O contraste que prova que a mudança é cirúrgica: a proteção antiga segue
    // inteira quando a competência fica de fato descoberta.
    const ctx = await empresaComSessao();
    const unico = await cobrancaPendente(ctx);
    gw.status.set(unico, "approved");
    await BillingService.handleWebhook(unico);

    gw.status.set(unico, "refunded");
    await BillingService.handleWebhook(unico);

    const depois = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { id: ctx.subscriptionId },
    });
    expect(depois.status).toBe("SUSPENSO");
    expect(depois.statusSource).toBe("MANUAL");
    expect((await rotateRefreshToken(ctx.refreshToken)).tipo).toBe("invalido");
  });
});
