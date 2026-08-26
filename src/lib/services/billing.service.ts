import type {
  ChargeMethod,
  PaymentStatus,
  SubscriptionPayment,
  SubscriptionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { revokeAllForTenant } from "@/lib/auth/refresh";
import { addOneMonth, computeStatus } from "@/lib/billing/status";
import { money, toNumber, type Decimal } from "@/lib/money";
import {
  appUrl,
  assertMercadoPagoConfig,
  createCardPayment,
  createPixPayment,
  getPayment,
  isMercadoPagoConfigured,
  mercadoPagoErrorMessage,
  MercadoPagoApiError,
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
import { sendEmail, paymentApprovedEmail, subscriptionDueSoonEmail } from "@/lib/email";
import { describeError, logger } from "@/lib/logger";
import { civilParts, refMonthTz, zonedTimeToUtc } from "@/lib/tz";
import { TERMS_VERSION } from "@/lib/legal";

/** Validade da cobrança do mês (QR PIX e preferência de cartão). */
const CHARGE_TTL_HOURS = 48;
/** Antecedência do lembrete de vencimento, em dias. */
export const DUE_REMINDER_DAYS = 3;
/** Só reconcilia cobranças com alguns minutos de vida, para não competir com o webhook. */
const RECONCILE_MIN_AGE_MINUTES = 10;

const CARD_PAYMENT_TYPE: Record<"CREDIT_CARD" | "DEBIT_CARD", CardPaymentTypeId> = {
  CREDIT_CARD: "credit_card",
  DEBIT_CARD: "debit_card",
};

/**
 * Mês de referência da mensalidade, no fuso do app.
 *
 * Com `getMonth()` puro, o servidor em UTC já estava no mês seguinte a partir
 * das 21h do último dia — quem pagasse no fim da noite de 31/08 recebia uma
 * cobrança marcada como setembro, e agosto ficava eternamente em aberto.
 */
function currentRefMonth(d = new Date()): string {
  return refMonthTz(d);
}

function previousRefMonth(d = new Date()): string {
  const c = civilParts(d);
  return refMonthTz(zonedTimeToUtc(c.year, c.month - 1, 1));
}

/**
 * Status do Mercado Pago que revertem uma cobrança JÁ APROVADA.
 * É a lista fechada que autoriza cortar o acesso de quem pagou — qualquer
 * outro status vindo da API é tratado como leitura suspeita, não como reversão.
 */
const REVERSAL_MP_STATUSES = new Set(["refunded", "charged_back", "cancelled"]);

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

/**
 * Status da assinatura quando um pagamento JÁ APROVADO é revertido.
 * Chargeback é mais grave que estorno: o titular contestou a cobrança junto ao
 * emissor, então a conta fica BLOQUEADA (e não apenas suspensa) até o
 * super-admin analisar o caso.
 */
export function reversalSubscriptionStatus(mpStatus: string): SubscriptionStatus {
  return mpStatus === "charged_back" ? "BLOQUEADO" : "SUSPENSO";
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

/**
 * Converte a recusa da API do Mercado Pago em erro de negócio.
 *
 * Sem isto o objeto lançado pelo SDK (que não é `Error`) escapava até o handler
 * genérico e virava "Erro inesperado (ref: …)" na tela, com "[object Object]" no
 * log — impossível de diagnosticar. Aqui o motivo chega ao usuário e o detalhe
 * completo já foi logado por `mpCall`.
 */
async function withMpError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MercadoPagoApiError) {
      throw new BusinessRuleError(mercadoPagoErrorMessage(e), "GATEWAY_REJECTED");
    }
    throw e;
  }
}

function assertGatewayReady(): void {
  if (!isMercadoPagoConfigured()) {
    throw new BusinessRuleError(
      "Pagamento online ainda não configurado. Fale com o suporte para regularizar.",
    );
  }
  assertMercadoPagoConfig();
}

/**
 * Guarda a prova de aceite dos Termos (LGPD): data, IP e versão do documento.
 * Só grava quando ainda não há aceite ou quando a versão publicada mudou —
 * assim o histórico registra a revisão que o cliente de fato leu. A validação de
 * que o aceite foi marcado é do schema Zod, na borda.
 */
async function registerTermsAcceptance(
  tenantId: string,
  ctx: TenantCtx | undefined,
  now: Date,
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { termsVersion: true },
  });
  if (tenant?.termsVersion === TERMS_VERSION) return;

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      termsAcceptedAt: now,
      termsAcceptedIp: ctx?.ip ?? null,
      termsVersion: TERMS_VERSION,
    },
  });
}

interface ChargeContext {
  subscriptionId: string;
  refMonth: string;
  amount: Decimal;
  description: string;
  payerEmail: string;
  /** Nome do dono da empresa — o PIX espera nome do pagador, não só e-mail. */
  payerName: string | null;
  /** CNPJ da empresa, quando cadastrado, como documento do pagador. */
  payerIdentification: { type: string; number: string } | null;
  externalRefPrefix: string;
}

/** CNPJ do tenant como identificação do pagador, se estiver completo. */
function identificacaoDoPagador(cnpj: string | null): { type: string; number: string } | null {
  const digitos = (cnpj ?? "").replace(/\D/g, "");
  if (digitos.length !== 14) return null;
  return { type: "CNPJ", number: digitos };
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

  // A guarda de "mês já pago" vem ANTES da troca de plano: trocar primeiro
  // deixava o cliente com o plano novo e sem cobrança nenhuma — a exceção
  // abortava o pagamento, mas a troca já estava gravada.
  const refMonth = currentRefMonth(now);
  const alreadyPaid = await prisma.subscriptionPayment.findFirst({
    where: { tenantId, referenceMonth: refMonth, status: "APROVADO" },
  });
  if (alreadyPaid) throw new BusinessRuleError("A mensalidade deste mês já está paga.");

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

  await registerTermsAcceptance(tenantId, ctx, now);

  return {
    subscriptionId: sub.id,
    refMonth,
    amount: money(sub.monthlyAmount),
    description: `CeasaPro - mensalidade ${refMonth} - ${sub.tenant.tradeName}`,
    payerEmail: sub.tenant.users[0]?.email ?? "sememail@ceasapro.com.br",
    payerName: sub.tenant.users[0]?.name ?? sub.tenant.tradeName,
    payerIdentification: identificacaoDoPagador(sub.tenant.cnpj),
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
    // O default só atende chamadas internas: as rotas sempre passam o input já
    // validado por `checkoutSchema`, que exige o aceite explícito dos termos.
    input: CheckoutInput = { method: "PIX", acceptedTerms: true },
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
    // Um QR em aberto só serve se ainda vale E se cobra o valor de hoje. Depois
    // de uma troca de plano o valor da assinatura muda, e devolver o QR antigo
    // faria a empresa pagar o preço do plano antigo e receber o novo (ou o
    // contrário, no downgrade).
    const mesmoValor = existing ? money(existing.amount).equals(charge.amount) : false;
    if (existing?.qrCode && isUsable(existing, now) && mesmoValor) return existing;
    if (existing?.qrCode) {
      await prisma.subscriptionPayment.update({
        where: { id: existing.id },
        data: { status: "CANCELADO" },
      });
      logger.info(
        { tenantId, chargeId: existing.id, motivo: mesmoValor ? "expirada" : "valor mudou" },
        "Cobrança PIX anterior cancelada — gerando nova",
      );
    }

    const pix = await withMpError(() =>
      createPixPayment({
        amount: toNumber(charge.amount),
        description: charge.description,
        payerEmail: charge.payerEmail,
        payerName: charge.payerName,
        payerIdentification: charge.payerIdentification,
        externalReference: externalRef,
        expiresAt,
      }),
    );

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

    const paid = await withMpError(() =>
      createCardPayment({
        amount: toNumber(charge.amount),
        description: charge.description,
        externalReference: externalRef,
        token: input.token,
        paymentMethodId: input.paymentMethodId,
        paymentTypeId: CARD_PAYMENT_TYPE[input.method],
        issuerId: input.issuerId,
        installments: input.installments,
        payer: input.payer,
      }),
    );

    // O cartão substitui qualquer PIX ainda em aberto do mesmo mês — só DEPOIS
    // que o Mercado Pago aceitou a tentativa. Cancelar antes deixava a empresa
    // sem nenhuma forma de pagar quando o cartão era recusado: o QR já tinha
    // sido invalidado e a tela não oferecia outro.
    await prisma.subscriptionPayment.updateMany({
      where: { tenantId, referenceMonth: charge.refMonth, status: "PENDENTE" },
      data: { status: "CANCELADO" },
    });

    // `upsert`, não `create`: a chave de idempotência do cartão é determinística
    // (mesmo mês + mesmo token), então tentar de novo com o MESMO cartão faz o
    // Mercado Pago devolver o MESMO pagamento. Com `create`, essa segunda
    // tentativa batia no índice único de `mpPaymentId` e virava erro 500 — logo
    // depois de uma recusa, que é exatamente quando a pessoa tenta outra vez.
    await prisma.subscriptionPayment.upsert({
      where: { mpPaymentId: paid.mpPaymentId },
      create: {
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
      update: {
        // Volta a PENDENTE para o status real ser reaplicado logo abaixo; sem
        // isto `applyPaymentStatus` veria o mesmo status e ignoraria a rodada.
        status: "PENDENTE",
        amount: charge.amount,
        method: input.method,
        statusDetail: paid.statusDetail,
        threeDsUrl: paid.threeDs?.externalResourceUrl ?? null,
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

    // Sair de APROVADO só é legítimo por reversão explícita. Qualquer outro
    // status (inclusive os que `mapMpStatus` agrupa em PENDENTE, como
    // `in_process` e `authorized`) seria uma leitura estranha da API — e como o
    // cron agora reconsulta as cobranças APROVADAS todo dia, aceitá-la
    // derrubaria o acesso de quem pagou. Na dúvida, não mexe.
    if (payment.status === "APROVADO" && !REVERSAL_MP_STATUSES.has(mp.status)) {
      logger.warn(
        { mpPaymentId: mp.id, mpStatus: mp.status },
        "Cobrança aprovada com status inesperado no Mercado Pago — mantida como está",
      );
      return "ignorado";
    }

    const now = new Date();
    // Estorno, chargeback ou cancelamento de uma cobrança que já estava aprovada:
    // o mês pago deixa de valer e o acesso precisa ser cortado na hora.
    const isReversal = payment.status === "APROVADO";

    const aplicado = await prisma.$transaction(async (tx) => {
      // Guarda contra corrida: só um webhook concorrente consegue a transição.
      const { count } = await tx.subscriptionPayment.updateMany({
        where: { id: payment.id, status: { not: newStatus } },
        data: {
          status: newStatus,
          statusDetail: mp.statusDetail ?? payment.statusDetail,
          // Saiu de pendente: o desafio 3DS não vale mais nada.
          threeDsUrl: newStatus === "PENDENTE" ? payment.threeDsUrl : null,
          paidAt: newStatus === "APROVADO" ? (mp.paidAt ?? now) : payment.paidAt,
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
          // Assinatura nova (nunca ativada) ou vencida há tempos tem
          // `currentPeriodEnd` no passado: o ciclo recomeça hoje, senão o mês
          // recém-pago já nasceria vencido e a empresa seguiria bloqueada.
          const periodStart = sub.currentPeriodEnd > now ? new Date(sub.currentPeriodEnd) : now;
          const periodEnd = addOneMonth(periodStart);
          await tx.tenantSubscription.update({
            where: { id: sub.id },
            data: {
              status: "ATIVO",
              // Volta ao cálculo automático: um pagamento aprovado encerra
              // qualquer bloqueio manual herdado de estorno/chargeback anterior.
              statusSource: "AUTO",
              statusReason: null,
              currentPeriodEnd: periodEnd,
              // Marca a primeira ativação; nas renovações o valor é preservado.
              activatedAt: sub.activatedAt ?? mp.paidAt ?? now,
            },
          });
          await tx.subscriptionPayment.update({
            where: { id: payment.id },
            data: { periodStart, periodEnd },
          });
        }
      }

      if (isReversal) {
        const sub = await tx.tenantSubscription.findUnique({
          where: { id: payment.subscriptionId },
        });
        if (sub) {
          const blockedStatus = reversalSubscriptionStatus(mp.status);
          await tx.tenantSubscription.update({
            where: { id: sub.id },
            data: {
              status: blockedStatus,
              // MANUAL trava o recálculo do cron: sem isto, a tolerância de
              // `graceDays` devolveria o acesso (status VENCIDO) logo após o
              // estorno. Um novo pagamento aprovado volta a fonte para AUTO.
              statusSource: "MANUAL",
              statusReason: `Pagamento ${mp.status} no Mercado Pago (${mp.id})`,
              // O mês estornado deixa de valer: o período volta ao que era antes.
              currentPeriodEnd: payment.periodStart ?? sub.currentPeriodEnd,
            },
          });
          await audit(
            {
              tenantId: payment.tenantId,
              action: "ACCESS_REVOKED",
              entity: "TenantSubscription",
              entityId: sub.id,
              oldData: { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
              newData: {
                status: blockedStatus,
                mpStatus: mp.status,
                mpPaymentId: mp.id,
                sessionsRevoked: true,
              },
            },
            tx,
          );
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

    if (isReversal) {
      // Derruba as sessões abertas: o access token expira em minutos e o
      // refresh já não renova, então o acesso cai sem depender de novo login.
      await revokeAllForTenant(payment.tenantId);
      logger.warn(
        { tenantId: payment.tenantId, mpPaymentId: mp.id, mpStatus: mp.status },
        "Pagamento revertido — assinatura bloqueada e sessões revogadas",
      );
    }

    if (newStatus === "APROVADO") {
      // Recibo por e-mail: best-effort, nunca derruba o processamento.
      void this.enviarReciboPagamento(payment.id).catch((e) =>
        logger.error(
          { err: describeError(e) },
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
   * Rede de segurança para webhook perdido: consulta no Mercado Pago as
   * cobranças do mês atual e do anterior e aplica o status real.
   *
   * Cobre os dois sentidos:
   *  - PENDENTE → o webhook de aprovação se perdeu e a empresa pagou sem receber
   *    acesso;
   *  - APROVADO → o webhook de **estorno/chargeback** se perdeu e a empresa
   *    segue usando o sistema depois de a cobrança ter sido revertida. Só o
   *    webhook cuidava disso, então uma entrega perdida ficava permanente.
   *
   * A janela de dois meses limita o custo (uma consulta por cobrança, por dia).
   * Chargeback aberto depois disso não é recuperado aqui — chega pelo webhook ou
   * pela conferência manual no painel do Mercado Pago.
   */
  async reconcilePendingPayments(now = new Date()) {
    if (!isMercadoPagoConfigured()) return { verificados: 0, atualizados: 0 };

    // A idade mínima vale só para as PENDENTES: recém-criada, a cobrança ainda
    // está sendo resolvida pelo webhook e consultar agora só gastaria chamada.
    const cutoff = new Date(now.getTime() - RECONCILE_MIN_AGE_MINUTES * 60 * 1000);
    const cobrancas = await prisma.subscriptionPayment.findMany({
      where: {
        mpPaymentId: { not: null },
        referenceMonth: { in: [currentRefMonth(now), previousRefMonth(now)] },
        OR: [
          { status: "PENDENTE", createdAt: { lt: cutoff } },
          { status: "APROVADO" },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    let atualizados = 0;
    for (const p of cobrancas) {
      if (!p.mpPaymentId) continue;
      try {
        const mp = await getPayment(p.mpPaymentId);
        const r = await this.applyPaymentStatus(mp);
        if (r === "aplicado") atualizados++;
      } catch (e) {
        logger.error(
          { mpPaymentId: p.mpPaymentId, err: describeError(e) },
          "Falha ao reconciliar cobrança",
        );
      }
    }
    return { verificados: cobrancas.length, atualizados };
  },

  /**
   * Avisa por e-mail quem vence nos próximos `DUE_REMINDER_DAYS` dias.
   *
   * Sem isto o cliente só descobria o vencimento ao ser bloqueado. O aviso sai
   * uma única vez por período: a marca é o próprio registro de auditoria
   * `SUBSCRIPTION_DUE_REMINDER`, procurado dentro da janela deste vencimento —
   * assim o cron diário não repete o e-mail nos dias seguintes, e o período
   * seguinte (com `currentPeriodEnd` novo) volta a ser elegível.
   *
   * Só entra quem já é cliente pagante e está em dia: assinatura `ATIVO` com
   * `activatedAt`. Quem nunca pagou já vê a cobrança na tela toda vez que
   * entra, e quem está vencido/suspenso já foi avisado pelo bloqueio.
   */
  async enviarLembretesDeVencimento(now = new Date()) {
    const limite = new Date(now.getTime() + DUE_REMINDER_DAYS * 24 * 60 * 60 * 1000);

    const subs = await prisma.tenantSubscription.findMany({
      where: {
        status: "ATIVO",
        activatedAt: { not: null },
        cancelledAt: null,
        currentPeriodEnd: { gte: now, lte: limite },
        tenant: { deletedAt: null, status: "ACTIVE" },
      },
      include: {
        tenant: { include: { users: { where: { role: "OWNER", deletedAt: null }, take: 1 } } },
      },
      take: 500,
    });

    let enviados = 0;
    for (const sub of subs) {
      const owner = sub.tenant.users[0];
      // Sem OWNER não há para quem escrever (o ambiente do super-admin, por
      // exemplo, não tem um) — segue sem marcar nada.
      if (!owner) continue;

      // Início da janela deste vencimento: qualquer lembrete gravado daqui para
      // frente já é o deste período.
      const janelaInicio = new Date(
        sub.currentPeriodEnd.getTime() - DUE_REMINDER_DAYS * 24 * 60 * 60 * 1000,
      );
      const jaAvisado = await prisma.auditLog.findFirst({
        where: {
          tenantId: sub.tenantId,
          entity: "TenantSubscription",
          entityId: sub.id,
          action: "SUBSCRIPTION_DUE_REMINDER",
          createdAt: { gte: janelaInicio },
        },
        select: { id: true },
      });
      if (jaAvisado) continue;

      const diasRestantes = Math.max(
        1,
        Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      );
      const mail = subscriptionDueSoonEmail({
        ownerName: owner.name,
        tradeName: sub.tenant.tradeName,
        amount: sub.monthlyAmount.toString(),
        dueDate: sub.currentPeriodEnd,
        daysAhead: diasRestantes,
        graceDays: sub.graceDays,
        appUrl: appUrl(),
      });
      const res = await sendEmail(owner.email, mail.subject, mail.html, {
        tags: [{ name: "tipo", value: "lembrete-vencimento" }],
      });
      // Só marca depois do envio dar certo: falha transitória do SMTP deve
      // deixar o cron de amanhã tentar de novo, não silenciar o aviso.
      if (!res.ok) {
        logger.error(
          { tenantId: sub.tenantId, err: res.error },
          "Falha ao enviar lembrete de vencimento — será tentado no próximo cron",
        );
        continue;
      }
      await audit({
        tenantId: sub.tenantId,
        action: "SUBSCRIPTION_DUE_REMINDER",
        entity: "TenantSubscription",
        entityId: sub.id,
        newData: {
          dueDate: sub.currentPeriodEnd.toISOString(),
          daysAhead: diasRestantes,
          to: owner.email,
        },
      });
      enviados++;
    }
    return { candidatos: subs.length, enviados };
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
