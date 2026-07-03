import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { computeStatus } from "@/lib/billing/status";
import {
  createPixPayment,
  getPayment,
  isMercadoPagoConfigured,
} from "@/lib/payments/mercadopago";
import { BusinessRuleError, NotFoundError } from "@/lib/http/app-error";
import { logger } from "@/lib/logger";

function currentRefMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
    const pendingCharge = await prisma.subscriptionPayment.findFirst({
      where: { tenantId, referenceMonth: refMonth, status: "PENDENTE" },
      orderBy: { createdAt: "desc" },
    });
    return { sub, pendingCharge };
  },

  /** Cria (ou retorna) a cobrança PIX do mês atual — idempotente por mês de referência. */
  async createOrGetMonthlyCharge(tenantId: string) {
    if (!isMercadoPagoConfigured()) {
      throw new BusinessRuleError(
        "Pagamento online ainda não configurado. Fale com o suporte para regularizar.",
      );
    }
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { tenant: { include: { users: { where: { role: "OWNER" }, take: 1 } } } },
    });
    if (!sub) throw new NotFoundError("Assinatura não encontrada");

    const refMonth = currentRefMonth();
    const existing = await prisma.subscriptionPayment.findFirst({
      where: { tenantId, referenceMonth: refMonth, status: "PENDENTE" },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.qrCode) return existing;

    const payerEmail = sub.tenant.users[0]?.email ?? "sememail@ceasapro.com.br";
    const externalRef = `sub:${sub.id}:${refMonth}`;
    const amount = Number(sub.monthlyAmount);

    const charge = await createPixPayment({
      amount,
      description: `CeasaPro - mensalidade ${refMonth} - ${sub.tenant.tradeName}`,
      payerEmail,
      externalReference: externalRef,
    });

    return prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        tenantId,
        amount,
        status: "PENDENTE",
        method: "pix",
        referenceMonth: refMonth,
        mpPaymentId: charge.mpPaymentId,
        mpExternalRef: externalRef,
        qrCode: charge.qrCode,
        qrCodeBase64: charge.qrCodeBase64,
        ticketUrl: charge.ticketUrl,
      },
    });
  },

  /** Processa o webhook do Mercado Pago (idempotente). */
  async handleWebhook(mpPaymentId: string) {
    const mp = await getPayment(mpPaymentId);
    const payment = await prisma.subscriptionPayment.findUnique({
      where: { mpPaymentId },
    });
    if (!payment) {
      logger.warn({ mpPaymentId }, "Webhook: pagamento não encontrado no banco");
      return;
    }

    const approved = mp.status === "approved";
    const newStatus = approved
      ? "APROVADO"
      : mp.status === "rejected"
        ? "RECUSADO"
        : mp.status === "refunded"
          ? "ESTORNADO"
          : mp.status === "cancelled"
            ? "CANCELADO"
            : "PENDENTE";

    if (payment.status === newStatus) return; // idempotente

    await prisma.$transaction(async (tx) => {
      await tx.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: newStatus,
          paidAt: approved ? new Date() : payment.paidAt,
          rawPayload: mp as unknown as object,
        },
      });

      if (approved) {
        const sub = await tx.tenantSubscription.findUnique({ where: { id: payment.subscriptionId } });
        if (sub) {
          const nextPeriodEnd = new Date(sub.currentPeriodEnd);
          nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);
          await tx.tenantSubscription.update({
            where: { id: sub.id },
            data: {
              status: "ATIVO",
              statusSource: "AUTO",
              currentPeriodEnd: nextPeriodEnd,
              trialEndsAt: null,
            },
          });
        }
      }

      await audit(
        {
          tenantId: payment.tenantId,
          action: "PAYMENT",
          entity: "SubscriptionPayment",
          entityId: payment.id,
          newData: { status: newStatus },
        },
        tx,
      );
    });
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
