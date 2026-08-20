import type { PaymentStatus, SubscriptionPayment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { addOneMonth, computeStatus } from "@/lib/billing/status";
import {
  appUrl,
  assertMercadoPagoConfig,
  createCardPayment,
  createPixPayment,
  getPayment,
  isMercadoPagoConfigured,
  type MpPayment,
} from "@/lib/payments/mercadopago";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { sendEmail, paymentApprovedEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

export interface CardInput {
  token: string;
  paymentMethodId: string;
  installments: number;
}

/** Validade da cobrança do mês (QR PIX e preferência de cartão). */
const CHARGE_TTL_HOURS = 48;
/** Só reconcilia cobranças com alguns minutos de vida, para não competir com o webhook. */
const RECONCILE_MIN_AGE_MINUTES = 10;

export type ChargeMethod = "pix" | "card";

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

function isUsable(charge: SubscriptionPayment | null, now = new Date()): boolean {
  if (!charge) return false;
  if (charge.expiresAt && charge.expiresAt <= now) return false;
  return true;
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
   * Cria (ou retorna) a cobrança da mensalidade do mês atual — idempotente por mês.
   * - PIX: reusa a cobrança pendente (renova o QR se expirou).
   * - Cartão: cria o pagamento a partir do token do Brick e resolve o status
   *   pelo mesmo caminho do webhook (handleWebhook) — ativa na hora se aprovado.
   */
  async createOrGetMonthlyCharge(
    tenantId: string,
    method: ChargeMethod = "pix",
    card?: CardInput,
  ) {
    if (!isMercadoPagoConfigured()) {
      throw new BusinessRuleError(
        "Pagamento online ainda não configurado. Fale com o suporte para regularizar.",
      );
    }
    assertMercadoPagoConfig();

    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { tenant: { include: { users: { where: { role: "OWNER" }, take: 1 } } } },
    });
    if (!sub) throw new NotFoundError("Assinatura não encontrada");

    const now = new Date();
    const refMonth = currentRefMonth(now);

    const alreadyPaid = await prisma.subscriptionPayment.findFirst({
      where: { tenantId, referenceMonth: refMonth, status: "APROVADO" },
    });
    if (alreadyPaid) {
      throw new BusinessRuleError("A mensalidade deste mês já está paga.");
    }

    const payerEmail = sub.tenant.users[0]?.email ?? "sememail@ceasapro.com.br";
    const externalRef = `sub:${sub.id}:${refMonth}:${method}`;
    const amount = Number(sub.monthlyAmount);
    const description = `CeasaPro - mensalidade ${refMonth} - ${sub.tenant.tradeName}`;
    const expiresAt = new Date(now.getTime() + CHARGE_TTL_HOURS * 60 * 60 * 1000);

    if (method === "card") {
      if (!card) throw new BusinessRuleError("Dados do cartão ausentes.");

      await prisma.subscriptionPayment.updateMany({
        where: { tenantId, referenceMonth: refMonth, status: "PENDENTE" },
        data: { status: "CANCELADO" },
      });

      const paid = await createCardPayment({
        amount,
        description,
        payerEmail,
        externalReference: externalRef,
        token: card.token,
        paymentMethodId: card.paymentMethodId,
        installments: card.installments,
      });

      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          tenantId,
          amount,
          status: "PENDENTE",
          method: "card",
          referenceMonth: refMonth,
          mpPaymentId: paid.mpPaymentId,
          mpExternalRef: externalRef,
        },
      });

      await this.handleWebhook(paid.mpPaymentId);
      const row = await prisma.subscriptionPayment.findUnique({
        where: { mpPaymentId: paid.mpPaymentId },
      });
      return row!;
    }

    const existing = await prisma.subscriptionPayment.findFirst({
      where: { tenantId, referenceMonth: refMonth, status: "PENDENTE", method: "pix" },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.qrCode && isUsable(existing, now)) return existing;
    if (existing?.qrCode && !isUsable(existing, now)) {
      await prisma.subscriptionPayment.update({
        where: { id: existing.id },
        data: { status: "CANCELADO" },
      });
      logger.info({ tenantId, chargeId: existing.id }, "Cobrança PIX expirada cancelada — gerando nova");
    }

    const charge = await createPixPayment({
      amount,
      description,
      payerEmail,
      externalReference: externalRef,
      expiresAt,
    });

    // Idempotente também do nosso lado: o mpPaymentId é único.
    return prisma.subscriptionPayment.upsert({
      where: { mpPaymentId: charge.mpPaymentId },
      create: {
        subscriptionId: sub.id,
        tenantId,
        amount,
        status: "PENDENTE",
        method,
        referenceMonth: refMonth,
        mpPaymentId: charge.mpPaymentId,
        mpExternalRef: externalRef,
        qrCode: charge.qrCode,
        qrCodeBase64: charge.qrCodeBase64,
        ticketUrl: charge.ticketUrl,
        expiresAt: charge.expiresAt ?? expiresAt,
      },
      update: {
        qrCode: charge.qrCode,
        qrCodeBase64: charge.qrCodeBase64,
        ticketUrl: charge.ticketUrl,
        expiresAt: charge.expiresAt ?? expiresAt,
      },
    });
  },

  /**
   * Aplica o status do Mercado Pago na cobrança (idempotente e à prova de corrida).
   * Retorna o que aconteceu, para o webhook e o cron logarem de forma útil.
   */
  async applyPaymentStatus(mp: MpPayment): Promise<"aplicado" | "ignorado" | "nao_encontrado"> {
    // Cartão nasce de uma Preference: o pagamento só ganha id na hora do pagamento,
    // então correlacionamos pela referência externa e anexamos o mpPaymentId.
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
          paidAt: newStatus === "APROVADO" ? (mp.paidAt ?? new Date()) : payment.paidAt,
          method: payment.method ?? mp.method,
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
  async reconcilePending(now = new Date()) {
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
      try {
        const mp = await getPayment(p.mpPaymentId!);
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
