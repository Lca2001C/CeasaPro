import type { ChargeMethod, PaymentStatus, SubscriptionPayment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { addOneMonth, computeStatus } from "@/lib/billing/status";
import { money, toNumber, type Decimal } from "@/lib/money";
import {
  appUrl,
  assertMercadoPagoConfig,
  createCardPayment,
  createPixPayment,
  getPayment,
  isMercadoPagoConfigured,
  type CardPaymentTypeId,
  type MpPayment,
} from "@/lib/payments/mercadopago";
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from "@/lib/http/app-error";
import type { TenantCtx } from "@/lib/http/with-action";
import type {
  CardPaymentInput,
  CardPaymentResult,
  CheckoutInput,
} from "@/lib/validations/billing";
import { PlanoService } from "./plano.service";
import { sendEmail, paymentApprovedEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

/** Validade da cobrança do mês (QR PIX e preferência de cartão). */
const CHARGE_TTL_HOURS = 48;
/** Só reconcilia cobranças com alguns minutos de vida, para não competir com o webhook. */
const RECONCILE_MIN_AGE_MINUTES = 10;

const CARD_PAYMENT_TYPE: Record<"CREDIT_CARD" | "DEBIT_CARD", CardPaymentTypeId> = {
  CREDIT_CARD: "credit_card",
  DEBIT_CARD: "debit_card",
};

function currentRefMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function previousRefMonth(d = new Date()): string {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return currentRefMonth(prev);
}

/** Mapeia o status do Mercado Pago para o nosso enum. */
export function mapMpStatus(mpStatus: string): PaymentStatus {
  switch (mpStatus) {
    case "approved":
      return "APROVADO";
    case "rejected":
      return "RECUSADO";
    case "refunded":
    case "charged_back":
      return "ESTORNADO";
    case "cancelled":
      return "CANCELADO";
    default:
      return "PENDENTE";
  }
}

/** Mapeia a forma de pagamento do Mercado Pago para o enum `ChargeMethod`. */
export function mapMpMethod(mp: Pick<MpPayment, "method" | "paymentTypeId">): ChargeMethod | null {
  switch (mp.paymentTypeId) {
    case "credit_card":
      return "CREDIT_CARD";
    case "debit_card":
      return "DEBIT_CARD";
    case "bank_transfer":
      return "PIX";
    default:
      return mp.method === "pix" ? "PIX" : null;
  }
}

function isUsable(charge: SubscriptionPayment | null, now = new Date()): boolean {
  if (!charge) return false;
  if (charge.expiresAt && charge.expiresAt <= now) return false;
  return true;
}

function assertGatewayReady(): void {
  if (!isMercadoPagoConfigured()) {
    throw new BusinessRuleError(
      "Pagamento online ainda não configurado. Fale com o suporte para regularizar.",
    );
  }
  assertMercadoPagoConfig();
}

interface ChargeContext {
  subscriptionId: string;
  refMonth: string;
  amount: Decimal;
  description: string;
  payerEmail: string;
  externalRefPrefix: string;
}

/**
 * Contexto comum a PIX e cartão: assinatura, valor do mês e guarda de
 * "mensalidade já paga". Opcionalmente troca o plano antes de cobrar.
 */
async function prepareCharge(
  tenantId: string,
  planId: string | undefined,
  ctx: TenantCtx | undefined,
  now: Date,
): Promise<ChargeContext> {
  assertGatewayReady();

  let sub = await prisma.tenantSubscription.findUnique({
    where: { tenantId },
    include: { tenant: { include: { users: { where: { role: "OWNER" }, take: 1 } } } },
  });
  if (!sub) throw new NotFoundError("Assinatura não encontrada");

  // Contratar outro plano no ato do pagamento: a validação de plano ativo e de
  // limite de usuários é do PlanoService — não duplicamos a regra aqui.
  if (planId && planId !== sub.planId) {
    if (!ctx) throw new ValidationError("Troca de plano exige um usuário autenticado.");
    await PlanoService.changePlan(planId, ctx);
    sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { tenantId },
      include: { tenant: { include: { users: { where: { role: "OWNER" }, take: 1 } } } },
    });
  }

  const refMonth = currentRefMonth(now);
  const alreadyPaid = await prisma.subscriptionPayment.findFirst({
    where: { tenantId, referenceMonth: refMonth, status: "APROVADO" },
  });
  if (alreadyPaid) throw new BusinessRuleError("A mensalidade deste mês já está paga.");

  return {
    subscriptionId: sub.id,
    refMonth,
    amount: money(sub.monthlyAmount),
    description: `CeasaPro - mensalidade ${refMonth} - ${sub.tenant.tradeName}`,
    payerEmail: sub.tenant.users[0]?.email ?? "sememail@ceasapro.com.br",
    externalRefPrefix: `sub:${sub.id}:${refMonth}`,
  };
}

export const BillingService = {
  mpConfigured: isMercadoPagoConfigured,

  async getStatus(tenantId: string) {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { plan: true, tenant: true },
    });
    if (!sub) return null;
    const refMonth = currentRefMonth();
    const [pendingCharge, paidCharge] = await Promise.all([
      prisma.subscriptionPayment.findFirst({
        where: { tenantId, referenceMonth: refMonth, status: "PENDENTE" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.subscriptionPayment.findFirst({
        where: { tenantId, referenceMonth: refMonth, status: "APROVADO" },
        orderBy: { paidAt: "desc" },
      }),
    ]);
    return { sub, pendingCharge, paidCharge, refMonth };
  },

  /**
   * Cria (ou retorna) a cobrança PIX da mensalidade do mês — idempotente por mês:
   * reusa a cobrança pendente e só renova o QR quando ele expirou.
   * Cartão não passa por aqui: precisa do token do Brick (ver `processCardPayment`).
   */
  async createCheckout(
    tenantId: string,
    input: CheckoutInput = { method: "PIX" },
    ctx?: TenantCtx,
  ): Promise<SubscriptionPayment> {
    if (input.method !== "PIX") {
      throw new ValidationError("Pagamento com cartão exige os dados do cartão.");
    }

    const now = new Date();
    const charge = await prepareCharge(tenantId, input.planId, ctx, now);
    const externalRef = `${charge.externalRefPrefix}:pix`;
    const expiresAt = new Date(now.getTime() + CHARGE_TTL_HOURS * 60 * 60 * 1000);

    const existing = await prisma.subscriptionPayment.findFirst({
      where: { tenantId, referenceMonth: charge.refMonth, status: "PENDENTE", method: "PIX" },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.qrCode && isUsable(existing, now)) return existing;
    if (existing?.qrCode) {
      await prisma.subscriptionPayment.update({
        where: { id: existing.id },
        data: { status: "CANCELADO" },
      });
      logger.info(
        { tenantId, chargeId: existing.id },
        "Cobrança PIX expirada cancelada — gerando nova",
      );
    }

    const pix = await createPixPayment({
      amount: toNumber(charge.amount),
      description: charge.description,
      payerEmail: charge.payerEmail,
      externalReference: externalRef,
      expiresAt,
    });

    // Idempotente também do nosso lado: o mpPaymentId é único.
    return prisma.subscriptionPayment.upsert({
      where: { mpPaymentId: pix.mpPaymentId },
      create: {
        subscriptionId: charge.subscriptionId,
        tenantId,
        amount: charge.amount,
        status: "PENDENTE",
        method: "PIX",
        referenceMonth: charge.refMonth,
        mpPaymentId: pix.mpPaymentId,
        mpExternalRef: externalRef,
        qrCode: pix.qrCode,
        qrCodeBase64: pix.qrCodeBase64,
        ticketUrl: pix.ticketUrl,
        expiresAt: pix.expiresAt ?? expiresAt,
      },
      update: {
        qrCode: pix.qrCode,
        qrCodeBase64: pix.qrCodeBase64,
        ticketUrl: pix.ticketUrl,
        expiresAt: pix.expiresAt ?? expiresAt,
      },
    });
  },

  /**
   * Cobra no CARTÃO (crédito ou débito) com o token do Payment Brick.
   * Débito pode exigir autenticação 3DS: nesse caso a cobrança fica PENDENTE e
   * devolvemos a URL do desafio para o browser abrir; o webhook conclui depois.
   * Sem desafio, o status é resolvido pelo mesmo caminho do webhook (idempotente).
   */
  async processCardPayment(
    tenantId: string,
    input: CardPaymentInput,
    ctx?: TenantCtx,
  ): Promise<CardPaymentResult> {
    // A maioria dos emissores brasileiros recusa débito sem CPF do portador.
    if (input.method === "DEBIT_CARD" && !input.payer.identification) {
      throw new ValidationError("Informe o CPF do titular para pagar no débito.", {
        "payer.identification": "Obrigatório para cartão de débito",
      });
    }

    const now = new Date();
    const charge = await prepareCharge(tenantId, input.planId, ctx, now);
    const externalRef = `${charge.externalRefPrefix}:${input.method.toLowerCase()}`;

    // O cartão substitui qualquer PIX ainda em aberto do mesmo mês.
    await prisma.subscriptionPayment.updateMany({
      where: { tenantId, referenceMonth: charge.refMonth, status: "PENDENTE" },
      data: { status: "CANCELADO" },
    });

    const paid = await createCardPayment({
      amount: toNumber(charge.amount),
      description: charge.description,
      externalReference: externalRef,
      token: input.token,
      paymentMethodId: input.paymentMethodId,
      paymentTypeId: CARD_PAYMENT_TYPE[input.method],
      issuerId: input.issuerId,
      installments: input.installments,
      payer: input.payer,
    });

    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: charge.subscriptionId,
        tenantId,
        amount: charge.amount,
        status: "PENDENTE",
        method: input.method,
        statusDetail: paid.statusDetail,
        threeDsUrl: paid.threeDs?.externalResourceUrl ?? null,
        referenceMonth: charge.refMonth,
        mpPaymentId: paid.mpPaymentId,
        mpExternalRef: externalRef,
      },
    });

    // Desafio 3DS: o pagamento só se resolve depois que o portador autenticar.
    if (paid.threeDs) {
      logger.info({ tenantId, mpPaymentId: paid.mpPaymentId }, "Cartão exigiu desafio 3DS");
      return {
        status: "PENDENTE",
        statusDetail: paid.statusDetail,
        mpPaymentId: paid.mpPaymentId,
        referenceMonth: charge.refMonth,
        threeDsUrl: paid.threeDs.externalResourceUrl,
        threeDsCreq: paid.threeDs.creq,
      };
    }

    await this.handleWebhook(paid.mpPaymentId);
    const row = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { mpPaymentId: paid.mpPaymentId },
    });
    return {
      status: row.status,
      statusDetail: row.statusDetail,
      mpPaymentId: row.mpPaymentId,
      referenceMonth: row.referenceMonth,
      threeDsUrl: null,
      threeDsCreq: null,
    };
  },

  /**
   * Aplica o status do Mercado Pago na cobrança (idempotente e à prova de corrida).
   * Retorna o que aconteceu, para o webhook e o cron logarem de forma útil.
   */
  async applyPaymentStatus(mp: MpPayment): Promise<"aplicado" | "ignorado" | "nao_encontrado"> {
    // Cobranças criadas por Preference só ganham id na hora do pagamento:
    // correlacionamos pela referência externa e anexamos o mpPaymentId.
    let payment = await prisma.subscriptionPayment.findUnique({
      where: { mpPaymentId: mp.id },
    });
    if (!payment && mp.externalReference) {
      payment = await prisma.subscriptionPayment.findFirst({
        where: { mpExternalRef: mp.externalReference, mpPaymentId: null },
        orderBy: { createdAt: "desc" },
      });
      if (payment) {
        payment = await prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: { mpPaymentId: mp.id },
        });
      }
    }
    if (!payment) {
      logger.warn({ mpPaymentId: mp.id }, "Webhook: pagamento não encontrado no banco");
      return "nao_encontrado";
    }

    const newStatus = mapMpStatus(mp.status);
    if (payment.status === newStatus) return "ignorado"; // idempotente

    const aplicado = await prisma.$transaction(async (tx) => {
      // Guarda contra corrida: só um webhook concorrente consegue a transição.
      const { count } = await tx.subscriptionPayment.updateMany({
        where: { id: payment.id, status: { not: newStatus } },
        data: {
          status: newStatus,
          statusDetail: mp.statusDetail ?? payment.statusDetail,
          // Saiu de pendente: o desafio 3DS não vale mais nada.
          threeDsUrl: newStatus === "PENDENTE" ? payment.threeDsUrl : null,
          paidAt: newStatus === "APROVADO" ? (mp.paidAt ?? new Date()) : payment.paidAt,
          method: payment.method ?? mapMpMethod(mp),
          rawPayload: mp as unknown as object,
        },
      });
      if (count !== 1) return false;

      if (newStatus === "APROVADO") {
        const sub = await tx.tenantSubscription.findUnique({
          where: { id: payment.subscriptionId },
        });
        if (sub) {
          const periodStart = new Date(sub.currentPeriodEnd);
          const periodEnd = addOneMonth(sub.currentPeriodEnd);
          await tx.tenantSubscription.update({
            where: { id: sub.id },
            data: {
              status: "ATIVO",
              statusSource: "AUTO",
              currentPeriodEnd: periodEnd,
              trialEndsAt: null,
            },
          });
          await tx.subscriptionPayment.update({
            where: { id: payment.id },
            data: { periodStart, periodEnd },
          });
        }
      }

      await audit(
        {
          tenantId: payment.tenantId,
          action: "PAYMENT",
          entity: "SubscriptionPayment",
          entityId: payment.id,
          newData: { status: newStatus, mpPaymentId: mp.id },
        },
        tx,
      );
      return true;
    });

    if (!aplicado) return "ignorado";

    if (newStatus === "APROVADO") {
      // Recibo por e-mail: best-effort, nunca derruba o processamento.
      void this.enviarReciboPagamento(payment.id).catch((e) =>
        logger.error(
          { err: e instanceof Error ? e.message : String(e) },
          "Falha ao enviar recibo de pagamento",
        ),
      );
    }
    return "aplicado";
  },

  /** Processa o webhook do Mercado Pago (idempotente). */
  async handleWebhook(mpPaymentId: string) {
    const mp = await getPayment(mpPaymentId);
    return this.applyPaymentStatus(mp);
  },

  /**
   * Rede de segurança para webhook perdido: consulta no Mercado Pago as cobranças
   * ainda PENDENTES do mês atual e do anterior e aplica o status real.
   */
  async reconcilePendingPayments(now = new Date()) {
    if (!isMercadoPagoConfigured()) return { verificados: 0, atualizados: 0 };

    const cutoff = new Date(now.getTime() - RECONCILE_MIN_AGE_MINUTES * 60 * 1000);
    const pendentes = await prisma.subscriptionPayment.findMany({
      where: {
        status: "PENDENTE",
        mpPaymentId: { not: null },
        createdAt: { lt: cutoff },
        referenceMonth: { in: [currentRefMonth(now), previousRefMonth(now)] },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    let atualizados = 0;
    for (const p of pendentes) {
      if (!p.mpPaymentId) continue;
      try {
        const mp = await getPayment(p.mpPaymentId);
        const r = await this.applyPaymentStatus(mp);
        if (r === "aplicado") atualizados++;
      } catch (e) {
        logger.error(
          { mpPaymentId: p.mpPaymentId, err: e instanceof Error ? e.message : String(e) },
          "Falha ao reconciliar cobrança",
        );
      }
    }
    return { verificados: pendentes.length, atualizados };
  },

  async enviarReciboPagamento(paymentId: string) {
    const payment = await prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      include: {
        subscription: {
          include: {
            tenant: { include: { users: { where: { role: "OWNER" }, take: 1 } } },
          },
        },
      },
    });
    const owner = payment?.subscription.tenant.users[0];
    if (!payment || !owner) return;

    const mail = paymentApprovedEmail({
      ownerName: owner.name,
      tradeName: payment.subscription.tenant.tradeName,
      amount: payment.amount.toString(),
      referenceMonth: payment.referenceMonth,
      nextDueDate: payment.periodEnd ?? payment.subscription.currentPeriodEnd,
      appUrl: appUrl(),
    });
    await sendEmail(owner.email, mail.subject, mail.html);
  },

  /** Recalcula o status de todas as assinaturas (cron diário). */
  async recomputeStatuses() {
    const subs = await prisma.tenantSubscription.findMany();
    let updated = 0;
    for (const sub of subs) {
      const effective = computeStatus(sub);
      if (effective !== sub.status) {
        await prisma.tenantSubscription.update({
          where: { id: sub.id },
          data: { status: effective },
        });
        updated++;
      }
    }
    return { total: subs.length, updated };
  },
};
