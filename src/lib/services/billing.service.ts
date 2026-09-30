import type {
  ChargeMethod,
  PaymentStatus,
  Prisma,
  SubscriptionPayment,
  SubscriptionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { revokeAllForTenant } from "@/lib/auth/refresh";
import { addOneMonth, computeStatus } from "@/lib/billing/status";
import { gte, money, toNumber, type Decimal } from "@/lib/money";
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
import {
  baixarPendentes,
  cancelarNoGateway,
  type CobrancaBaixada,
} from "@/lib/payments/cobrancas-pendentes";
import { PlanoService } from "./plano.service";
import { AdminNotificationsService } from "./admin-notifications.service";
import { sendEmail, paymentApprovedEmail, subscriptionDueSoonEmail } from "@/lib/email";
import { describeError, logger } from "@/lib/logger";
import {
  addDaysTz,
  civilParts,
  endOfDayTz,
  refMonthTz,
  startOfDayTz,
  zonedTimeToUtc,
} from "@/lib/tz";
import { TERMS_VERSION } from "@/lib/legal";
import { cnpjValido, normalizarCnpj } from "@/lib/cnpj";

/** Validade da cobrança do mês (QR PIX e preferência de cartão). */
const CHARGE_TTL_HOURS = 48;
/** Antecedência do lembrete de vencimento, em dias. */
export const DUE_REMINDER_DAYS = 3;

/**
 * Quantos dias de CALENDÁRIO (fuso do app) separam `de` de `ate`: 28/09 13:30 →
 * 30/09 18:00 são 2, não os 3 do `ceil` sobre horas corridas. Arredonda para
 * absorver a hora de diferença de uma virada de horário de verão.
 */
export function diasDeCalendario(de: Date, ate: Date): number {
  return Math.round(
    (startOfDayTz(ate).getTime() - startOfDayTz(de).getTime()) / (24 * 60 * 60 * 1000),
  );
}
/** Só reconcilia cobranças com alguns minutos de vida, para não competir com o webhook. */
const RECONCILE_MIN_AGE_MINUTES = 10;

/** Teto de cada lote da reconciliação diária (pendentes, canceladas e aprovadas separados). */
const RECONCILE_BATCH = 200;

/**
 * Orçamento de tempo padrão da reconciliação.
 *
 * A rota do cron tem 60 s (teto do Hobby) e ainda precisa recalcular status,
 * mandar lembretes, gerar despesas, limpar tabelas e importar boletins. Antes
 * a reconciliação não tinha prazo e consultava até 400 cobranças uma a uma: com
 * ~100–150 pagantes ela sozinha passava do teto, e a plataforma matava a função
 * antes de tudo o que vinha depois — em silêncio.
 */
export const RECONCILE_BUDGET_MS = 20_000;

/** Consultas simultâneas ao Mercado Pago. Baixo o bastante para não levar 429. */
const RECONCILE_CONCURRENCY = 6;

/** Prazo de cada consulta: uma resposta pendurada não pode segurar o lote. */
const RECONCILE_MP_TIMEOUT_MS = 8_000;

/**
 * Por quanto tempo uma cobrança CANCELADA ainda é relida no Mercado Pago: a
 * validade do QR mais folga para o webhook atrasado. Passado isso, o PIX
 * expirou lá e não há mais como ele ser pago.
 */
const RECONCILE_CANCELADAS_JANELA_MS = (CHARGE_TTL_HOURS + 72) * 60 * 60 * 1000;

/** Status do Mercado Pago de uma cobrança que não pode mais ser paga. */
const PIX_MORTO = new Set(["cancelled", "rejected"]);

/** Por que um pagamento aprovado no Mercado Pago não comprou mês nenhum. */
type MotivoNaoCreditado = "VALOR_MENOR" | "DUPLICADO";

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

/** "2026-12" → "2027-01". Aritmética sobre o rótulo, sem fuso nenhum envolvido. */
function mesSeguinte(ref: string): string {
  const [ano, mes] = ref.split("-").map(Number);
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;
}

/**
 * A renovação já pode ser paga? É a MESMA janela do lembrete de vencimento
 * (`DUE_REMINDER_DAYS`, por dia de calendário): o e-mail diz "vence em 3 dias,
 * pague aqui", e o botão dele precisa levar a um pagamento possível.
 *
 * Período já vencido também conta (dias negativos): quem venceu e ainda tem a
 * competência do calendário marcada como paga — a noite do último dia de um
 * período de 28/02, ou um vencimento recuado por estorno de mês anterior —
 * ficaria sem ter como pagar até o mês virar.
 *
 * Só para quem já pagou alguma vez: antes da ativação não há período a renovar.
 */
export function dentroDaJanelaDeRenovacao(
  sub: { activatedAt: Date | null; currentPeriodEnd: Date },
  now: Date,
): boolean {
  return (
    sub.activatedAt !== null && diasDeCalendario(now, sub.currentPeriodEnd) <= DUE_REMINDER_DAYS
  );
}

async function competenciaAprovada(tenantId: string, referenceMonth: string) {
  return prisma.subscriptionPayment.findFirst({
    where: { tenantId, referenceMonth, status: "APROVADO" },
    orderBy: { paidAt: "desc" },
  });
}

/**
 * Qual competência a PRÓXIMA cobrança compra — e se ela já está paga.
 *
 * A regra era "o mês do calendário": com ele pago, qualquer cobrança nova era
 * recusada (MENSALIDADE_JA_PAGA) até o mês virar. Só que o período pago não
 * acompanha o calendário: quem pagou em 01/09 vence em 01/10, recebe em 28/09 o
 * lembrete "vence em 3 dias" e, clicando nele, dava com "a mensalidade deste
 * mês já está paga". O lembrete não era atendível — só dava para pagar já
 * vencido.
 *
 * Agora, com o mês corrente pago E dentro da janela de renovação, a cobrança é
 * da competência do período que está sendo comprado: `refMonthTz` do
 * vencimento (o período novo começa nele). Se esse rótulo coincide com o mês
 * corrente — período que vence no fim do próprio mês, como 31/08 → 30/09 —, é o
 * mês seguinte, senão a competência colidiria com a já paga.
 *
 * O que não muda: fora da janela, mês pago é mês pago; e a chave `approvedKey`
 * (`<tenant>:<competência>`) continua garantindo um crédito por competência —
 * pagar adiantado duas vezes esbarra nela como qualquer duplicata.
 */
export async function competenciaACobrar(
  tenantId: string,
  sub: { activatedAt: Date | null; currentPeriodEnd: Date },
  now: Date,
): Promise<{ refMonth: string; antecipada: boolean; paga: SubscriptionPayment | null }> {
  const corrente = currentRefMonth(now);
  const pagaCorrente = await competenciaAprovada(tenantId, corrente);
  if (!pagaCorrente || !dentroDaJanelaDeRenovacao(sub, now)) {
    return { refMonth: corrente, antecipada: false, paga: pagaCorrente };
  }
  const doPeriodo = refMonthTz(sub.currentPeriodEnd);
  const proxima = doPeriodo > corrente ? doPeriodo : mesSeguinte(corrente);
  return {
    refMonth: proxima,
    antecipada: true,
    paga: await competenciaAprovada(tenantId, proxima),
  };
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

/**
 * Chave que o banco usa para garantir **uma única cobrança APROVADA por
 * competência** (`SubscriptionPayment.approvedKey`, `@unique`).
 *
 * Preenchida só enquanto a cobrança está aprovada; em qualquer outro status ela
 * é `null`, e vários `null` não colidem em índice único no Postgres — então
 * recusada, estornada e cancelada continuam podendo repetir à vontade no mesmo
 * mês, que é o caso comum de quem tenta pagar três vezes até o cartão passar.
 */
function chaveDeAprovacao(
  status: PaymentStatus,
  tenantId: string,
  referenceMonth: string,
): string | null {
  return status === "APROVADO" ? `${tenantId}:${referenceMonth}` : null;
}

/**
 * O erro é a violação do índice único de `approvedKey` (P2002)?
 *
 * É o que sobra quando dois webhooks da mesma competência atravessam o
 * `findFirst` ao mesmo tempo: um grava, o outro esbarra no banco. Reconhecer o
 * caso é o que separa "segunda aprovação recusada, como projetado" de um erro de
 * verdade — que precisa continuar subindo.
 */
function violouChaveDeAprovacao(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: unknown; meta?: { target?: unknown } };
  if (err.code !== "P2002") return false;
  const alvo = err.meta?.target;
  const campos = Array.isArray(alvo) ? alvo.map(String) : [String(alvo ?? "")];
  return campos.some((c) => c.includes("approvedKey"));
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

/** Vencimento depois de estornar `payment`: tira só a duração do período dele. */
function periodoSemOEstornado(
  currentPeriodEnd: Date,
  payment: { periodStart: Date | null; periodEnd: Date | null },
): Date {
  if (!payment.periodStart || !payment.periodEnd) return currentPeriodEnd;
  const duracao = payment.periodEnd.getTime() - payment.periodStart.getTime();
  return new Date(currentPeriodEnd.getTime() - duracao);
}

/**
 * Valor que a PRÓXIMA aprovação compra.
 *
 * A aprovação soma um mês a partir de `currentPeriodEnd` (ou de agora, se já
 * venceu). Com troca de plano agendada para esse instante, o período comprado
 * é do plano NOVO — cobrar `monthlyAmount` (o do plano vigente) entregava o mês
 * do plano caro pelo preço do barato: o agendamento só adiava o desconto.
 * No downgrade, é o inverso: a pessoa pagaria o mês do básico pelo completo.
 *
 * Usado para gerar a cobrança E para conferir o valor que entrou — as duas
 * pontas precisam concordar, senão o pagamento correto seria recusado.
 *
 * Plano agendado INATIVO não conta. A virada (`aplicarTrocaProgramada`)
 * descarta a troca para plano fora de oferta e a empresa segue no vigente;
 * cobrar o preço do agendado seria vender o mês de um plano que ela não vai
 * receber. O painel já recusa desativar plano com troca agendada, mas há dado
 * gravado antes dessa trava — e para ele a única resposta segura é o plano que
 * de fato vai valer.
 */
export function valorDevido(
  sub: {
    monthlyAmount: Decimal;
    currentPeriodEnd: Date;
    pendingPlanFrom: Date | null;
    pendingPlan: { priceMonthly: Decimal; active: boolean } | null;
  },
  now: Date,
): Decimal {
  const inicio = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
  if (
    sub.pendingPlan &&
    sub.pendingPlan.active &&
    sub.pendingPlanFrom &&
    sub.pendingPlanFrom <= inicio
  ) {
    return money(sub.pendingPlan.priceMonthly);
  }
  return money(sub.monthlyAmount);
}

/**
 * Estados de onde uma cobrança pode voltar a PENDENTE quando o Mercado Pago
 * devolve o MESMO pagamento pela chave de idempotência. APROVADO e ESTORNADO
 * ficam de fora: reabrir a aprovada fazia a rodada seguinte do webhook
 * aprová-la DE NOVO — não havia "outra aprovada" (é a mesma linha) e cada
 * aprovação empurra `currentPeriodEnd` mais um mês. Dois cliques em "Pagar"
 * com o mesmo token compravam dois meses por uma cobrança.
 */
const REABRIVEIS: PaymentStatus[] = ["PENDENTE", "RECUSADO", "CANCELADO"];

/**
 * Grava a cobrança devolvida pelo Mercado Pago sem nunca reabrir uma linha que
 * já tem dinheiro decidido. Substitui o `upsert`, que não sabe ser condicional:
 * o `updateMany` com filtro de status é atômico na linha, e o índice único de
 * `mpPaymentId` resolve a corrida entre dois `create`.
 */
async function gravarCobranca(
  mpPaymentId: string,
  create: Prisma.SubscriptionPaymentUncheckedCreateInput,
  update: Prisma.SubscriptionPaymentUncheckedUpdateManyInput,
): Promise<SubscriptionPayment> {
  const reaberta = await prisma.subscriptionPayment.updateMany({
    where: { mpPaymentId, status: { in: REABRIVEIS } },
    data: { ...update, status: "PENDENTE", approvedKey: null },
  });
  if (reaberta.count === 0) {
    const existente = await prisma.subscriptionPayment.findUnique({ where: { mpPaymentId } });
    if (existente) return existente; // APROVADO/ESTORNADO: devolve como está
    try {
      return await prisma.subscriptionPayment.create({ data: create });
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== "P2002") throw err;
      // Outro pedido criou a mesma linha entre o `findUnique` e o `create`.
    }
  }
  return prisma.subscriptionPayment.findUniqueOrThrow({ where: { mpPaymentId } });
}

/**
 * Registra um pagamento que o Mercado Pago APROVOU e que não comprou mês nenhum,
 * e avisa o super-admin — uma vez.
 *
 * Antes os dois casos (valor a menor, segunda aprovação da competência) só iam
 * para o log com "precisa de devolução ou crédito manual". Ninguém lê log
 * procurando dinheiro parado: o cliente pagou, não recebeu o que pagou, e a
 * primeira notícia disso era a reclamação dele — ou nenhuma.
 *
 * A marca (`uncreditedAt`) é gravada com compare-and-set: a reconciliação relê
 * a linha todo dia, e sem a marca o aviso sairia todo dia também.
 *
 * Linha PENDENTE sai de cena (vira CANCELADO): o QR dela JÁ FOI PAGO, e
 * mantê-la em aberto deixava a tela mostrando "Aguardando o pagamento" de um
 * código quitado, no lugar da cobrança certa. O status APROVADO fica de fora de
 * propósito — é ele que compra o mês, e é exatamente o que não pode acontecer.
 */
async function registrarNaoCreditado(
  payment: SubscriptionPayment,
  mp: MpPayment,
  motivo: MotivoNaoCreditado,
  detalhe: { devido?: Decimal | null; jaAprovado?: string | null },
): Promise<boolean> {
  const agora = new Date();
  const marcou = await prisma.$transaction(async (tx) => {
    const { count } = await tx.subscriptionPayment.updateMany({
      where: { id: payment.id, uncreditedAt: null, status: { notIn: ["APROVADO", "ESTORNADO"] } },
      data: {
        uncreditedAt: agora,
        uncreditedReason: motivo,
        statusDetail: mp.statusDetail ?? payment.statusDetail,
        ...(payment.status === "PENDENTE" ? { status: "CANCELADO", threeDsUrl: null } : {}),
      },
    });
    if (count !== 1) return false;
    await audit(
      {
        tenantId: payment.tenantId,
        action: "PAYMENT_NOT_CREDITED",
        entity: "SubscriptionPayment",
        entityId: payment.id,
        oldData: { status: payment.status },
        newData: {
          motivo,
          mpPaymentId: mp.id,
          mpStatus: mp.status,
          pago: String(mp.amount),
          devido: detalhe.devido?.toString() ?? null,
          jaAprovado: detalhe.jaAprovado ?? null,
          referenceMonth: payment.referenceMonth,
        },
      },
      tx,
    );
    return true;
  });
  if (!marcou) return false;

  const tenant = await prisma.tenant
    .findUnique({ where: { id: payment.tenantId }, select: { tradeName: true } })
    .catch(() => null);
  const empresa = tenant?.tradeName ?? payment.tenantId;
  await AdminNotificationsService.criar({
    kind: "PAGAMENTO_NAO_CREDITADO",
    title:
      motivo === "VALOR_MENOR"
        ? "Pagamento abaixo da mensalidade — mês não creditado"
        : "Segundo pagamento da mesma competência — mês não creditado",
    body:
      motivo === "VALOR_MENOR"
        ? `${empresa} pagou R$ ${money(mp.amount).toFixed(2)} (pagamento ${mp.id}, competência ` +
          `${payment.referenceMonth}), mas a mensalidade devida é R$ ${detalhe.devido?.toFixed(2) ?? "?"}. ` +
          "O valor entrou no Mercado Pago: credite a diferença ou devolva."
        : `${empresa} teve o pagamento ${mp.id} aprovado na competência ${payment.referenceMonth}, que já ` +
          `estava paga${detalhe.jaAprovado ? ` (pagamento ${detalhe.jaAprovado})` : ""}. ` +
          "O valor entrou no Mercado Pago e não comprou mês nenhum: devolva ou credite manualmente.",
    href: `/admin/clientes/${payment.tenantId}`,
    tenantId: payment.tenantId,
  });
  logger.error(
    { tenantId: payment.tenantId, mpPaymentId: mp.id, motivo, referenceMonth: payment.referenceMonth },
    "Pagamento aprovado e NÃO creditado — super-admin avisado",
  );
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

/**
 * CNPJ do tenant como identificação do pagador, se for um CNPJ válido.
 *
 * Conferir só o tamanho mandava ao Mercado Pago um CNPJ com dígito trocado
 * (base antiga, gravada antes de `cnpjSchema` validar o DV), e o PIX da
 * mensalidade era recusado com uma mensagem que não aponta o documento. Sem
 * identificação o PIX sai normalmente — o documento é opcional ali.
 */
export function identificacaoDoPagador(
  cnpj: string | null,
): { type: string; number: string } | null {
  if (!cnpj || !cnpjValido(cnpj)) return null;
  return { type: "CNPJ", number: normalizarCnpj(cnpj) };
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

  // Troca de plano agendada que já venceu passa a valer AQUI, antes de o valor
  // ser lido. O agendamento existe justamente porque a competência anterior
  // estava paga; se a cobrança da competência nova saísse pelo plano antigo, o
  // adiamento teria só empurrado o mesmo desconto para o mês seguinte.
  // Relê também quando havia agendamento e nada foi aplicado: ele pode ter sido
  // descartado (plano agendado fora de oferta).
  const tinhaAgendamento = sub.pendingPlanId !== null;
  if ((await PlanoService.aplicarTrocaProgramada(sub, now)) || tinhaAgendamento) {
    sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { tenantId },
      include: { tenant: { include: { users: { where: { role: "OWNER" }, take: 1 } } } },
    });
  }

  // A guarda de "mês já pago" vem ANTES da troca de plano: trocar primeiro
  // deixava o cliente com o plano novo e sem cobrança nenhuma — a exceção
  // abortava o pagamento, mas a troca já estava gravada.
  //
  // A competência não é mais sempre o mês do calendário: dentro da janela do
  // lembrete, com o mês corrente pago, é a do período que vai ser comprado
  // (ver `competenciaACobrar`).
  const alvo = await competenciaACobrar(tenantId, sub, now);
  const refMonth = alvo.refMonth;
  if (alvo.paga) {
    // Código próprio: a tela reage recarregando para o estado "já pago" em vez
    // de mostrar isto como erro. Não é falha do usuário — é a tela estando
    // desatualizada em relação a um pagamento que já entrou.
    throw new BusinessRuleError(
      alvo.antecipada
        ? `A mensalidade de ${refMonth} já está paga.`
        : "A mensalidade deste mês já está paga.",
      "MENSALIDADE_JA_PAGA",
    );
  }

  // Contratar outro plano no ato do pagamento: a validação (plano existente e
  // ativo, e o valor vindo sempre do plano) é do PlanoService — não duplicamos
  // a regra aqui.
  if (planId && planId !== sub.planId) {
    if (!ctx) throw new ValidationError("Troca de plano exige um usuário autenticado.");
    await PlanoService.changePlan(planId, ctx);
    sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { tenantId },
      include: { tenant: { include: { users: { where: { role: "OWNER" }, take: 1 } } } },
    });
  }

  await registerTermsAcceptance(tenantId, ctx, now);

  const pendingPlan = sub.pendingPlanId
    ? await prisma.plan.findUnique({
        where: { id: sub.pendingPlanId },
        select: { priceMonthly: true, active: true },
      })
    : null;

  return {
    subscriptionId: sub.id,
    refMonth,
    amount: valorDevido({ ...sub, pendingPlan }, now),
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
    // A MESMA competência que `prepareCharge` cobraria agora. Olhar só o mês do
    // calendário fazia a tela dizer "já paga" a quem estava na janela de
    // renovação — e o botão de pagar nem aparecia.
    const alvo = await competenciaACobrar(tenantId, sub, new Date());
    const refMonth = alvo.refMonth;
    const paidCharge = alvo.paga;
    const pendingCharge = await prisma.subscriptionPayment.findFirst({
      where: { tenantId, referenceMonth: refMonth, status: "PENDENTE" },
      orderBy: { createdAt: "desc" },
    });
    // Cobrança vencida NÃO é cobrança pendente para quem está olhando a tela.
    //
    // Sem este `isUsable`, quem gerava o PIX e não pagava em 48h voltava para
    // `/assinatura` e encontrava o QR MORTO com "Aguardando o pagamento": sem
    // botão de gerar outro código, sem o formulário de cartão e sem o seletor
    // de plano, porque a tela esconde tudo isso quando já existe cobrança
    // (`assinatura-client.tsx`, `payment-brick.tsx`). Como empresa SUSPENSA só
    // alcança `/assinatura`, ela ficava sem NENHUMA forma de pagar até o cron
    // do dia seguinte derrubar a linha — e só se o MP devolvesse `cancelled`.
    //
    // É o mesmo critério que `prepareCharge` já usa para decidir se reaproveita
    // a cobrança; faltava valer também para quem lê o status.
    return {
      sub,
      pendingCharge: isUsable(pendingCharge) ? pendingCharge : null,
      paidCharge,
      refMonth,
    };
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
    let substituida: CobrancaBaixada | null = null;
    if (existing) {
      substituida = existing;
      // Cancela QUALQUER pendente do mês que não será reaproveitada — inclusive
      // a que ficou sem `qrCode` (o Mercado Pago falhou no meio). Deixá-la
      // pendente criaria duas cobranças abertas para o mesmo mês, e a tela
      // mostraria a mais recente enquanto a reconciliação consultava a velha.
      await prisma.subscriptionPayment.update({
        where: { id: existing.id },
        data: { status: "CANCELADO" },
      });
      logger.info(
        {
          tenantId,
          chargeId: existing.id,
          motivo: !existing.qrCode ? "sem QR" : mesmoValor ? "expirada" : "valor mudou",
        },
        "Cobrança PIX anterior cancelada — gerando nova",
      );
    }

    const gerarPix = (idempotencySalt?: string) =>
      withMpError(() =>
        createPixPayment({
          amount: toNumber(charge.amount),
          description: charge.description,
          payerEmail: charge.payerEmail,
          payerName: charge.payerName,
          payerIdentification: charge.payerIdentification,
          externalReference: externalRef,
          expiresAt,
          idempotencySalt,
        }),
      );
    let pix = await gerarPix();
    // A chave de idempotência (referência + valor) devolveu uma cobrança MORTA:
    // é o QR deste mesmo valor que cancelamos no gateway quando o cliente trocou
    // de plano — e agora ele voltou ao plano de antes. Mostrá-lo seria entregar
    // um código que o banco recusa; pede outro com chave nova.
    if (PIX_MORTO.has(pix.status)) {
      logger.warn(
        { tenantId, mpPaymentId: pix.mpPaymentId, mpStatus: pix.status },
        "Mercado Pago devolveu cobrança PIX já encerrada pela idempotência — gerando outra",
      );
      pix = await gerarPix(String(now.getTime()));
    }

    // O QR substituído sai de circulação também no gateway — só depois de o
    // novo existir, e nunca quando o "novo" é ele mesmo (a idempotência do MP
    // devolve a MESMA cobrança quando o valor não mudou).
    if (substituida && substituida.mpPaymentId !== pix.mpPaymentId) {
      await cancelarNoGateway([substituida], { tenantId, motivo: "pix-substituido" }, now);
    }

    // O Mercado Pago é idempotente pela chave `pix:<ref>:<valor>`: pedir de
    // novo dentro da validade da chave devolve a MESMA cobrança. Se ela já foi
    // paga, `gravarCobranca` a devolve como está — reabrir uma cobrança quitada
    // faria a tela pedir pagamento de novo (e o webhook creditar outro mês).
    return gravarCobranca(
      pix.mpPaymentId,
      {
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
      // Volta a PENDENTE (dentro de `gravarCobranca`): a linha pode ter sido
      // CANCELADA logo acima (a anterior do mês era esta mesma, devolvida pela
      // idempotência do MP). Sem isto ela ficaria CANCELADA com QR válido na
      // tela, e o polling — que procura cobrança PENDENTE — nunca confirmaria.
      {
        amount: charge.amount,
        qrCode: pix.qrCode,
        qrCodeBase64: pix.qrCodeBase64,
        ticketUrl: pix.ticketUrl,
        expiresAt: pix.expiresAt ?? expiresAt,
      },
    );
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
    // que o Mercado Pago aceitou a tentativa, e só se ela não foi RECUSADA.
    // Cancelar antes deixava a empresa sem nenhuma forma de pagar quando o
    // cartão era recusado: o QR já tinha sido invalidado e a tela não oferecia
    // outro. A recusa do emissor não é exceção (volta como `status: rejected`),
    // então conferir só "a API respondeu" deixava o mesmo buraco aberto — agora
    // que o cancelamento vale também no gateway, o QR morreria de verdade.
    //
    // A própria linha do cartão fica de fora: a mesma tentativa repetida volta
    // com o mesmo `mpPaymentId` e é reaberta por `gravarCobranca` logo abaixo.
    if (!PIX_MORTO.has(paid.status)) {
      const substituidas = await baixarPendentes(prisma, {
        tenantId,
        referenceMonth: charge.refMonth,
        OR: [{ mpPaymentId: null }, { mpPaymentId: { not: paid.mpPaymentId } }],
      });
      await cancelarNoGateway(substituidas, { tenantId, motivo: "cartao-substituiu-pix" }, now);
    }

    // `upsert`, não `create`: a chave de idempotência do cartão é determinística
    // (mesmo mês + mesmo token), então tentar de novo com o MESMO cartão faz o
    // Mercado Pago devolver o MESMO pagamento. Com `create`, essa segunda
    // tentativa batia no índice único de `mpPaymentId` e virava erro 500 — logo
    // depois de uma recusa, que é exatamente quando a pessoa tenta outra vez.
    //
    // Volta a PENDENTE (em `gravarCobranca`) para o status real ser reaplicado
    // logo abaixo — mas nunca a partir de APROVADO/ESTORNADO: o segundo clique
    // com o mesmo token recebe a cobrança já decidida, sem crédito novo.
    await gravarCobranca(
      paid.mpPaymentId,
      {
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
      {
        amount: charge.amount,
        method: input.method,
        statusDetail: paid.statusDetail,
        threeDsUrl: paid.threeDs?.externalResourceUrl ?? null,
      },
    );

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

    // Cancelada por nós, ainda viva no gateway (o cancelamento lá falhou ou não
    // pegou): NÃO reabre. Voltar a PENDENTE ressuscitaria uma cobrança que foi
    // substituída — duas abertas no mesmo mês, e a tela mostrando a errada. Se
    // ela vier a ser paga, a aprovação passa por aqui normalmente.
    if (payment.status === "CANCELADO" && newStatus === "PENDENTE") return "ignorado";

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

    // O valor que ENTROU tem de cobrir a mensalidade DEVIDA.
    //
    // Trocar de plano marca a cobrança anterior como CANCELADO no nosso banco
    // e tenta cancelá-la no gateway — mas o cancelamento lá é de melhor
    // esforço, e o código antigo pode ter sido pago antes dele. Pagando o
    // código antigo — justamente o que já estava copiado no app do banco — o
    // mês era creditado por inteiro e a assinatura ficava ATIVA no plano NOVO,
    // mais caro, tendo entrado o valor do ANTIGO. Depois disso a guarda
    // MENSALIDADE_JA_PAGA bloqueava a cobrança correta do mês.
    //
    // Conferir contra `payment.amount` não pegaria nada: a linha antiga foi
    // cobrada em 49,90 e foi 49,90 que entrou. Quem decide é o valor devido.
    //
    // A checagem fica FORA da transação de propósito: abortá-la lá dentro não
    // desfaria o `updateMany` já aplicado. O mês não é creditado, a tela
    // continua oferecendo o pagamento certo — o cliente não fica com "já pago
    // neste mês" e sem acesso, que seria outro beco sem saída — e o super-admin
    // recebe o caso para resolver (crédito ou devolução).
    if (newStatus === "APROVADO") {
      const cobrado = await prisma.tenantSubscription.findUnique({
        where: { id: payment.subscriptionId },
        select: {
          monthlyAmount: true,
          currentPeriodEnd: true,
          pendingPlanFrom: true,
          pendingPlan: { select: { priceMonthly: true, active: true } },
        },
      });
      const devido = cobrado ? valorDevido(cobrado, new Date()) : null;
      if (devido && !gte(money(mp.amount), devido)) {
        logger.error(
          {
            mpPaymentId: mp.id,
            tenantId: payment.tenantId,
            pago: String(mp.amount),
            devido: devido.toString(),
          },
          "Pagamento aprovado com valor menor que a mensalidade — mês NÃO creditado",
        );
        await registrarNaoCreditado(payment, mp, "VALOR_MENOR", { devido });
        return "ignorado";
      }
    }

    const now = new Date();
    // Estorno, chargeback ou cancelamento de uma cobrança que já estava aprovada:
    // o mês pago deixa de valer e o acesso precisa ser cortado na hora.
    const isReversal = payment.status === "APROVADO";

    interface Resultado {
      aplicado: boolean;
      bloqueou: boolean;
      duplicado: boolean;
      /** `mpPaymentId` da aprovada que já ocupava a competência (duplicata). */
      jaAprovado?: string | null;
      /** Bloqueio MANUAL (chargeback/admin) desfeito por esta aprovação. */
      bloqueioDesfeito?: { status: SubscriptionStatus; motivo: string | null } | null;
      /** Outras cobranças abertas da competência, baixadas por esta aprovação. */
      outrasPendentes?: CobrancaBaixada[];
    }
    const NADA: Resultado = { aplicado: false, bloqueou: false, duplicado: false };

    const resultado = await prisma.$transaction(async (tx): Promise<Resultado> => {
      /*
        Uma única cobrança APROVADA por competência.

        Nada impedia duas: o PIX pago minutos depois de o cartão ter passado, o
        mesmo QR quitado duas vezes, dois webhooks concorrentes de cobranças
        distintas do mesmo mês. Cada aprovação empurrava `currentPeriodEnd` mais
        um mês (o bloco abaixo soma a partir do vencimento vigente), então pagar
        duas vezes em agosto comprava setembro sem cobrança — e, do outro lado da
        moeda, estornar UMA delas suspendia a empresa que ainda tinha a outra paga.

        A checagem vive DENTRO da transação, e o índice único de `approvedKey` é a
        rede embaixo dela: entre o `findFirst` e o `updateMany` ainda cabe outro
        webhook, e é o banco que decide quem chega primeiro.
      */
      if (newStatus === "APROVADO") {
        const outraAprovada = await tx.subscriptionPayment.findFirst({
          where: {
            tenantId: payment.tenantId,
            referenceMonth: payment.referenceMonth,
            status: "APROVADO",
            id: { not: payment.id },
          },
          select: { id: true, mpPaymentId: true },
        });
        if (outraAprovada) {
          logger.error(
            {
              tenantId: payment.tenantId,
              referenceMonth: payment.referenceMonth,
              mpPaymentId: mp.id,
              jaAprovado: outraAprovada.mpPaymentId,
            },
            "Segunda cobrança aprovada na mesma competência — mês NÃO creditado de novo. " +
              "O valor entrou no Mercado Pago e precisa de devolução ou crédito manual.",
          );
          return { ...NADA, duplicado: true, jaAprovado: outraAprovada.mpPaymentId };
        }
      }

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
          // Acompanha o status: sai de APROVADO, libera a competência.
          approvedKey: chaveDeAprovacao(newStatus, payment.tenantId, payment.referenceMonth),
          // Creditada: a pendência "aprovada e não creditada", se havia, acabou.
          ...(newStatus === "APROVADO" ? { uncreditedAt: null, uncreditedReason: null } : {}),
          rawPayload: mp as unknown as object,
        },
      });
      if (count !== 1) return NADA;

      let bloqueioDesfeito: Resultado["bloqueioDesfeito"] = null;
      let outrasPendentes: CobrancaBaixada[] = [];
      if (newStatus === "APROVADO") {
        const sub = await tx.tenantSubscription.findUnique({
          where: { id: payment.subscriptionId },
        });
        // A competência está paga: qualquer outra cobrança aberta dela (o QR
        // gerado de novo, o cartão parado no 3DS) só serviria para o cliente
        // pagar duas vezes. Sai daqui e, depois do commit, do gateway.
        outrasPendentes = await baixarPendentes(tx, {
          tenantId: payment.tenantId,
          referenceMonth: payment.referenceMonth,
          id: { not: payment.id },
        });
        if (sub) {
          // Bloqueio MANUAL em BLOQUEADO é decisão humana (chargeback, ou o
          // super-admin). O pagamento o desfaz — é o comportamento combinado:
          // quem pagou volta a usar —, mas quem decidiu precisa saber.
          if (sub.statusSource === "MANUAL" && sub.status === "BLOQUEADO") {
            bloqueioDesfeito = { status: sub.status, motivo: sub.statusReason };
            await audit(
              {
                tenantId: payment.tenantId,
                action: "STATUS_CHANGE",
                entity: "TenantSubscription",
                entityId: sub.id,
                oldData: {
                  status: sub.status,
                  statusSource: sub.statusSource,
                  statusReason: sub.statusReason,
                },
                newData: {
                  status: "ATIVO",
                  statusSource: "AUTO",
                  motivo: "bloqueio-manual-desfeito-por-pagamento",
                  mpPaymentId: mp.id,
                },
              },
              tx,
            );
          }
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
              // Pagar de novo desfaz o cancelamento: o cliente voltou a contratar.
              cancelledAt: null,
            },
          });
          await tx.subscriptionPayment.update({
            where: { id: payment.id },
            data: { periodStart, periodEnd },
          });
        }
      }

      let bloqueou = false;
      if (isReversal) {
        /*
          Estornar UMA cobrança não é estornar a competência.

          Antes, qualquer reversão suspendia a empresa e revogava as sessões. Só
          que a mesma competência pode ter mais de um pagamento aprovado por
          razões legítimas — o cliente pagou no cartão, o cartão foi contestado, o
          suporte gerou um PIX e ele foi quitado. Estornado o cartão, o mês
          continuava pago e o acesso caía mesmo assim: a empresa era bloqueada
          por um pagamento que ela tinha substituído, e só um humano no painel
          reabria (a reversão grava `statusSource: MANUAL`, que trava o cron).

          Com outro pagamento aprovado de pé, a reversão vira só o que ela é: uma
          linha do extrato mudando de status. `currentPeriodEnd` fica, o acesso
          fica, e a auditoria registra o caso para conferência.
        */
        const outraAprovada = await tx.subscriptionPayment.findFirst({
          where: {
            tenantId: payment.tenantId,
            referenceMonth: payment.referenceMonth,
            status: "APROVADO",
            id: { not: payment.id },
          },
          select: { id: true, mpPaymentId: true },
        });

        const sub = await tx.tenantSubscription.findUnique({
          where: { id: payment.subscriptionId },
        });

        if (outraAprovada) {
          logger.warn(
            {
              tenantId: payment.tenantId,
              referenceMonth: payment.referenceMonth,
              revertido: mp.id,
              mpStatus: mp.status,
              aindaAprovado: outraAprovada.mpPaymentId,
            },
            "Pagamento revertido, mas a competência segue paga por outra cobrança — acesso mantido",
          );
          await audit(
            {
              tenantId: payment.tenantId,
              action: "PAYMENT",
              entity: "SubscriptionPayment",
              entityId: payment.id,
              oldData: { status: "APROVADO" },
              newData: {
                status: newStatus,
                mpStatus: mp.status,
                mpPaymentId: mp.id,
                acessoMantido: true,
                aindaAprovado: outraAprovada.mpPaymentId,
              },
            },
            tx,
          );
        } else if (sub) {
          bloqueou = true;
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
              // O mês estornado deixa de valer — só ELE. Voltar para
              // `payment.periodStart` apagava junto os meses pagos DEPOIS dele:
              // estornar agosto com setembro já quitado devolvia o vencimento a
              // 10/08. Descontar a duração do período estornado dá o mesmo
              // resultado quando ele é o último, e o certo quando não é.
              currentPeriodEnd: periodoSemOEstornado(sub.currentPeriodEnd, payment),
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
      return { aplicado: true, bloqueou, duplicado: false, bloqueioDesfeito, outrasPendentes };
    })
      .catch((e: unknown): Resultado => {
        // Entre o `findFirst` lá em cima e este `updateMany` ainda cabe outro
        // webhook da mesma competência. Quando cabe, quem recusa a segunda
        // aprovação é o índice único — e o resultado é o mesmo: o mês não é
        // creditado duas vezes, e o log chama um humano para devolver o valor.
        if (!violouChaveDeAprovacao(e)) throw e;
        logger.error(
          {
            tenantId: payment.tenantId,
            referenceMonth: payment.referenceMonth,
            mpPaymentId: mp.id,
          },
          "Corrida entre dois pagamentos aprovados da mesma competência — o banco recusou " +
            "o segundo. O valor entrou no Mercado Pago e precisa de devolução ou crédito manual.",
        );
        return { ...NADA, duplicado: true };
      });

    if (resultado.duplicado) {
      // O dinheiro entrou e não comprou nada: não pode sumir no log.
      let jaAprovado = resultado.jaAprovado ?? null;
      if (!jaAprovado) {
        const outra = await prisma.subscriptionPayment.findFirst({
          where: {
            tenantId: payment.tenantId,
            referenceMonth: payment.referenceMonth,
            status: "APROVADO",
            id: { not: payment.id },
          },
          select: { mpPaymentId: true },
        });
        jaAprovado = outra?.mpPaymentId ?? null;
      }
      await registrarNaoCreditado(payment, mp, "DUPLICADO", { jaAprovado });
    }

    if (!resultado.aplicado) return "ignorado";

    if (resultado.outrasPendentes?.length) {
      await cancelarNoGateway(resultado.outrasPendentes, {
        tenantId: payment.tenantId,
        motivo: "competencia-paga",
      });
    }

    if (resultado.bloqueioDesfeito) {
      const tenant = await prisma.tenant
        .findUnique({ where: { id: payment.tenantId }, select: { tradeName: true } })
        .catch(() => null);
      await AdminNotificationsService.criar({
        kind: "BLOQUEIO_DESFEITO_POR_PAGAMENTO",
        title: "Empresa bloqueada voltou a ativa por pagamento",
        body:
          `${tenant?.tradeName ?? payment.tenantId} estava BLOQUEADA` +
          (resultado.bloqueioDesfeito.motivo ? ` (${resultado.bloqueioDesfeito.motivo})` : "") +
          ` e voltou a ter acesso porque o pagamento ${mp.id} (competência ` +
          `${payment.referenceMonth}) foi aprovado. Se o bloqueio precisa continuar, ` +
          "bloqueie de novo pelo painel.",
        href: `/admin/clientes/${payment.tenantId}`,
        tenantId: payment.tenantId,
      });
      logger.warn(
        { tenantId: payment.tenantId, mpPaymentId: mp.id, motivo: resultado.bloqueioDesfeito.motivo },
        "Bloqueio manual desfeito por pagamento aprovado — super-admin avisado",
      );
    }

    // Só revoga sessão quando a competência ficou de fato descoberta. Reversão
    // com outro pagamento válido no mês não derruba ninguém.
    if (resultado.bloqueou) {
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
   * cobranças da janela de competências e aplica o status real.
   *
   * Cobre três casos:
   *  - PENDENTE → o webhook de aprovação se perdeu e a empresa pagou sem receber
   *    acesso;
   *  - CANCELADO recente → a cobrança foi substituída (troca de plano, cartão,
   *    cancelamento), o cancelamento no gateway não pegou e o cliente pagou o QR
   *    velho. Sem reler, esse dinheiro só era visto se o webhook chegasse; agora
   *    ele é creditado quando cobre o devido, ou vira aviso ao super-admin
   *    (`registrarNaoCreditado`). Se o gateway ainda a mostra em aberto, o
   *    cancelamento é tentado de novo;
   *  - APROVADO → o webhook de **estorno/chargeback** se perdeu e a empresa
   *    segue usando o sistema depois de a cobrança ter sido revertida.
   *
   * A janela é mês anterior, corrente e seguinte — o seguinte existe desde que a
   * renovação pode ser paga adiantada (`competenciaACobrar`). Chargeback aberto
   * depois disso não é recuperado aqui — chega pelo webhook ou pela conferência
   * manual no painel do Mercado Pago.
   *
   * ## Prazo, concorrência e rotação
   *
   * Era um laço sequencial sem prazo sobre até 400 cobranças, e o cron tem 60 s
   * para tudo. Com ~100–150 pagantes a reconciliação sozinha estourava o teto e
   * a plataforma matava a função — levando junto, em silêncio, o recálculo de
   * status, os lembretes, as despesas recorrentes e os boletins.
   *
   *  - **Orçamento** (`orcamentoMs`): conferido antes de cada consulta. O que não
   *    coube fica para amanhã, e o retorno diz quantas ficaram.
   *  - **Concorrência limitada** (6 consultas simultâneas), agrupada por empresa:
   *    duas cobranças da mesma empresa nunca são aplicadas ao mesmo tempo, então
   *    a reversão de uma não corre contra a aprovação da outra.
   *  - **Rotação** (`lastReconciledAt`): cada lote lê primeiro as nunca
   *    conferidas e depois as conferidas há mais tempo; entre as nunca
   *    conferidas, as mais recentes. Um lote cortado pelo prazo não deixa sempre
   *    as mesmas de fora, e a aprovação de ontem é sempre das primeiras.
   *
   * A ordem entre os lotes continua: PENDENTES primeiro (são o resgate de quem
   * pagou e está sem acesso), depois as CANCELADAS, depois a varredura de
   * estorno.
   */
  async reconcilePendingPayments(
    opts: {
      now?: Date;
      /** Tempo máximo gasto aqui, em ms. Padrão: `RECONCILE_BUDGET_MS`. */
      orcamentoMs?: number;
      /** Consultas simultâneas ao Mercado Pago. */
      concorrencia?: number;
    } = {},
  ) {
    const now = opts.now ?? new Date();
    const resumo = {
      verificados: 0,
      atualizados: 0,
      pendentes: 0,
      canceladas: 0,
      aprovadas: 0,
      /** Ficaram para a próxima rodada porque o orçamento acabou. */
      naoVerificados: 0,
      esgotouTempo: false,
    };
    if (!isMercadoPagoConfigured()) return resumo;

    // Relógio de parede, e não `now`: o prazo é da execução, não do dado.
    const prazo = Date.now() + (opts.orcamentoMs ?? RECONCILE_BUDGET_MS);
    const concorrencia = Math.max(1, opts.concorrencia ?? RECONCILE_CONCURRENCY);

    // A idade mínima vale só para as PENDENTES: recém-criada, a cobrança ainda
    // está sendo resolvida pelo webhook e consultar agora só gastaria chamada.
    const cutoff = new Date(now.getTime() - RECONCILE_MIN_AGE_MINUTES * 60 * 1000);
    const meses = [previousRefMonth(now), currentRefMonth(now), mesSeguinte(currentRefMonth(now))];

    const orderBy: Prisma.SubscriptionPaymentOrderByWithRelationInput[] = [
      { lastReconciledAt: { sort: "asc", nulls: "first" } },
      { createdAt: "desc" },
    ];
    const select = {
      id: true,
      tenantId: true,
      mpPaymentId: true,
      status: true,
      expiresAt: true,
    } as const;

    // Três lotes, cada um com o seu teto. As pendentes são o resgate e não
    // podem disputar vaga com a varredura de estorno: com um lote só, as
    // aprovadas (reconsultadas todo dia) enchiam o teto antes de alcançar uma
    // única pendente.
    const pendentes = await prisma.subscriptionPayment.findMany({
      where: {
        mpPaymentId: { not: null },
        referenceMonth: { in: meses },
        status: "PENDENTE",
        createdAt: { lt: cutoff },
      },
      orderBy,
      take: RECONCILE_BATCH,
      select,
    });
    const canceladas = await prisma.subscriptionPayment.findMany({
      where: {
        mpPaymentId: { not: null },
        referenceMonth: { in: meses },
        OR: [
          // Ainda pode ter sido paga: o QR vale 48 h, mais folga de webhook.
          {
            status: "CANCELADO",
            createdAt: { gte: new Date(now.getTime() - RECONCILE_CANCELADAS_JANELA_MS) },
          },
          // Aprovada e não creditada: segue sendo relida para registrar o
          // desfecho (a devolução vira ESTORNADO e sai da fila sozinha).
          { uncreditedAt: { not: null }, status: { in: ["CANCELADO", "RECUSADO"] } },
        ],
      },
      orderBy,
      take: RECONCILE_BATCH,
      select,
    });
    const aprovadas = await prisma.subscriptionPayment.findMany({
      where: {
        mpPaymentId: { not: null },
        referenceMonth: { in: meses },
        status: "APROVADO",
      },
      orderBy,
      take: RECONCILE_BATCH,
      select,
    });
    resumo.pendentes = pendentes.length;
    resumo.canceladas = canceladas.length;
    resumo.aprovadas = aprovadas.length;

    // Truncamento tem de aparecer: um lote que satura todo dia significa
    // cobrança que demora a ser verificada (a rotação garante que chega).
    for (const [nome, lote] of [
      ["pendentes", pendentes],
      ["canceladas", canceladas],
      ["aprovadas", aprovadas],
    ] as const) {
      if (lote.length === RECONCILE_BATCH) {
        logger.warn(
          { lote: nome, teto: RECONCILE_BATCH },
          "Reconciliação atingiu o teto do lote — há cobranças não verificadas nesta rodada",
        );
      }
    }

    // Fila única na ordem de prioridade, sem repetir linha, agrupada por
    // empresa na ordem em que cada empresa aparece pela primeira vez.
    type Item = (typeof pendentes)[number];
    const vistos = new Set<string>();
    const porEmpresa = new Map<string, Item[]>();
    for (const p of [...pendentes, ...canceladas, ...aprovadas]) {
      if (!p.mpPaymentId || vistos.has(p.id)) continue;
      vistos.add(p.id);
      const grupo = porEmpresa.get(p.tenantId);
      if (grupo) grupo.push(p);
      else porEmpresa.set(p.tenantId, [p]);
    }
    const grupos = [...porEmpresa.values()];
    const total = vistos.size;

    const conferir = async (p: Item): Promise<void> => {
      try {
        const mp = await getPayment(p.mpPaymentId!, { timeoutMs: RECONCILE_MP_TIMEOUT_MS });
        const r = await this.applyPaymentStatus(mp);
        if (r === "aplicado") resumo.atualizados++;
        // Cancelada aqui, em aberto lá: o cancelamento no gateway falhou quando
        // a cobrança foi substituída. Enquanto não expira ela é pagável —
        // tenta de novo.
        if (p.status === "CANCELADO" && mapMpStatus(mp.status) === "PENDENTE") {
          await cancelarNoGateway([p], { tenantId: p.tenantId, motivo: "reconciliacao" }, now);
        }
      } catch (e) {
        logger.error(
          { mpPaymentId: p.mpPaymentId, err: describeError(e) },
          "Falha ao reconciliar cobrança",
        );
      } finally {
        // Marca mesmo na falha: uma cobrança que dá erro todo dia não pode
        // ficar para sempre na cabeça da fila tomando a vez das outras.
        await prisma.subscriptionPayment
          .updateMany({ where: { id: p.id }, data: { lastReconciledAt: new Date() } })
          .catch(() => {});
        resumo.verificados++;
      }
    };

    let proximo = 0;
    const trabalhador = async (): Promise<void> => {
      while (proximo < grupos.length) {
        const grupo = grupos[proximo++];
        for (const p of grupo) {
          if (Date.now() >= prazo) {
            resumo.esgotouTempo = true;
            return;
          }
          await conferir(p);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concorrencia, grupos.length) }, () => trabalhador()),
    );

    resumo.naoVerificados = total - resumo.verificados;
    if (resumo.esgotouTempo) {
      logger.warn(
        { verificados: resumo.verificados, naoVerificados: resumo.naoVerificados },
        "Reconciliação parou no orçamento de tempo — o restante vai primeiro na próxima rodada",
      );
    }
    return resumo;
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
    // Janela por dia de CALENDÁRIO (fuso do app), não por horas corridas: com
    // `now + 72h`, quem vence 30/09 às 18:00 ficava fora na rodada de 27/09
    // (13:30, faltando 3,19 dias) e recebia na de 28/09 "vence em 3 dias" —
    // com dois dias de antecedência e o texto errado por um.
    const limite = endOfDayTz(addDaysTz(now, DUE_REMINDER_DAYS));

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
        // O valor do e-mail é o que `prepareCharge` vai cobrar: com troca de
        // plano agendada para o vencimento, é o preço do plano NOVO.
        pendingPlan: { select: { priceMonthly: true, active: true } },
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
      // frente já é o deste período. Começo do DIA, pela mesma razão da
      // janela de candidatos: o envio pode sair na tarde de D-3 mesmo que o
      // vencimento seja às 23h, e uma janela de 72h exatas deixaria aquele
      // envio de fora — o cron do dia seguinte mandaria de novo.
      const janelaInicio = startOfDayTz(addDaysTz(sub.currentPeriodEnd, -DUE_REMINDER_DAYS));

      // 0 = vence hoje (o e-mail diz "hoje"). Só chega aqui se os envios dos dias
      // anteriores falharam; antes era grampeado em 1 e o texto dizia "amanhã".
      const diasRestantes = Math.max(0, diasDeCalendario(now, sub.currentPeriodEnd));
      const valor = valorDevido(sub, now);

      // Reserva a marca ANTES de enviar, numa transação serializada por
      // empresa. Checar, enviar e só depois gravar deixava duas execuções
      // sobrepostas do cron (entrega dupla, disparo manual) passarem as duas
      // pela checagem — dois e-mails iguais.
      const marca = await prisma.$transaction(async (tx) => {
        // Domínio 3 = lembrete de vencimento (o 1 é o de caixas plásticas).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sub.tenantId}), 3)`;
        const jaAvisado = await tx.auditLog.findFirst({
          where: {
            tenantId: sub.tenantId,
            entity: "TenantSubscription",
            entityId: sub.id,
            action: "SUBSCRIPTION_DUE_REMINDER",
            createdAt: { gte: janelaInicio },
          },
          select: { id: true },
        });
        if (jaAvisado) return null;
        return tx.auditLog.create({
          data: {
            tenantId: sub.tenantId,
            action: "SUBSCRIPTION_DUE_REMINDER",
            entity: "TenantSubscription",
            entityId: sub.id,
            newData: {
              dueDate: sub.currentPeriodEnd.toISOString(),
              daysAhead: diasRestantes,
              amount: valor.toString(),
              to: owner.email,
            },
            // O mesmo relógio da janela acima: a marca e a procura por ela
            // precisam concordar sobre "quando", mesmo com `now` injetado.
            createdAt: now,
          },
          select: { id: true },
        });
      });
      if (!marca) continue;

      const mail = subscriptionDueSoonEmail({
        ownerName: owner.name,
        tradeName: sub.tenant.tradeName,
        amount: valor.toString(),
        dueDate: sub.currentPeriodEnd,
        daysAhead: diasRestantes,
        graceDays: sub.graceDays,
        appUrl: appUrl(),
      });
      const res = await sendEmail(owner.email, mail.subject, mail.html, {
        tags: [{ name: "tipo", value: "lembrete-vencimento" }],
      }).catch((e: unknown) => ({ ok: false as const, error: describeError(e) }));
      // A marca só FICA se o envio deu certo: falha transitória do SMTP deve
      // deixar o cron de amanhã tentar de novo, não silenciar o aviso. A
      // reserva vira registro de falha, que o dedupe não procura.
      if (!res.ok) {
        logger.error(
          { tenantId: sub.tenantId, err: res.error },
          "Falha ao enviar lembrete de vencimento — será tentado no próximo cron",
        );
        await prisma.auditLog
          .update({ where: { id: marca.id }, data: { action: "SUBSCRIPTION_DUE_REMINDER_FAILED" } })
          .catch(() => {});
        continue;
      }
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

  /**
   * Recalcula o status de todas as assinaturas e faz valer as trocas de plano
   * agendadas que venceram (cron diário).
   *
   * As duas coisas juntas porque compartilham a varredura. A troca vem primeiro:
   * ela muda `monthlyAmount`, e é esse valor que a cobrança do mês novo usa.
   */
  async recomputeStatuses(now = new Date()) {
    // Empresa excluída não tem status a recalcular: o trabalho era inútil e
    // era ele que transformava a assinatura órfã em VENCIDO/SUSPENSO,
    // alimentando o cartão "Inadimplentes" do painel do super-admin.
    const subs = await prisma.tenantSubscription.findMany({
      where: { tenant: { deletedAt: null } },
    });
    let updated = 0;
    let planosTrocados = 0;
    for (const sub of subs) {
      // Sai na primeira linha quando não há agendamento: nenhuma consulta a mais
      // para as assinaturas comuns, que são a esmagadora maioria.
      if (await PlanoService.aplicarTrocaProgramada(sub, now)) planosTrocados++;

      const effective = computeStatus(sub, now);
      if (effective !== sub.status) {
        await prisma.tenantSubscription.update({
          where: { id: sub.id },
          data: { status: effective },
        });
        updated++;
      }
    }
    return { total: subs.length, updated, planosTrocados };
  },

  /**
   * O dono cancela a assinatura. Sem multa: o mês já pago segue até o vencimento
   * (Termos §5). Teste grátis e período já vencido encerram na hora. Cobranças
   * PIX/cartão ainda abertas são baixadas para não gerar pagamento depois do
   * pedido. Quem cancelou no meio do mês pago pode desfazer com `reativarAssinatura`.
   */
  async cancelarAssinatura(ctx: TenantCtx) {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: ctx.tenantId },
    });
    if (!sub) throw new NotFoundError("Assinatura não encontrada");
    if (sub.cancelledAt) {
      throw new BusinessRuleError("Esta assinatura já está cancelada.");
    }

    const agora = new Date();
    const antes = computeStatus(sub, agora);
    if (antes === "SUSPENSO" || antes === "BLOQUEADO" || antes === "CANCELADO") {
      throw new BusinessRuleError("Esta assinatura já está encerrada.");
    }

    const depois = computeStatus(
      { ...sub, cancelledAt: agora, statusSource: "AUTO" },
      agora,
    );

    const baixadas = await prisma.$transaction(async (tx) => {
      const abertas = await baixarPendentes(tx, { tenantId: ctx.tenantId });
      await tx.tenantSubscription.update({
        where: { id: sub.id },
        data: {
          cancelledAt: agora,
          status: depois,
          // Volta ao AUTO para o cron encerrar no vencimento, sem herdar MANUAL
          // de um episódio antigo (a action só chega aqui com acesso liberado).
          statusSource: "AUTO",
          statusReason: "Cancelamento pedido pelo dono da empresa",
          // Quem cancelou não vai estrear plano novo no mês que vem. Deixar o
          // agendamento de pé trocaria o plano (e o valor) de uma assinatura
          // encerrada, sozinho, dias depois.
          pendingPlanId: null,
          pendingPlanFrom: null,
        },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "SUBSCRIPTION_CANCELLED",
          entity: "TenantSubscription",
          entityId: sub.id,
          oldData: { status: sub.status, cancelledAt: null },
          newData: {
            status: depois,
            cancelledAt: agora,
            accessUntil: depois === "ATIVO" ? sub.currentPeriodEnd : null,
          },
          ip: ctx.ip,
        },
        tx,
      );
      return abertas;
    });

    // Quem pediu para parar de pagar não pode ter um QR ainda pagável no app do
    // banco: pago, ele desfaria o cancelamento sem o cliente querer.
    await cancelarNoGateway(baixadas, { tenantId: ctx.tenantId, motivo: "assinatura-cancelada" }, agora);

    if (depois === "CANCELADO") {
      await revokeAllForTenant(ctx.tenantId);
    }

    logger.info(
      { tenantId: ctx.tenantId, status: depois },
      "Assinatura cancelada pelo dono",
    );

    return {
      status: depois,
      accessUntil: depois === "ATIVO" ? sub.currentPeriodEnd : null,
    };
  },

  /**
   * Desfaz o cancelamento enquanto o período pago ainda vale. Depois do
   * vencimento o caminho é pagar de novo em `/assinatura`.
   */
  async reativarAssinatura(ctx: TenantCtx) {
    const sub = await prisma.tenantSubscription.findUnique({
      where: { tenantId: ctx.tenantId },
    });
    if (!sub) throw new NotFoundError("Assinatura não encontrada");
    if (!sub.cancelledAt) {
      throw new BusinessRuleError("A assinatura não está cancelada.");
    }

    const agora = new Date();
    const depois = computeStatus({ ...sub, cancelledAt: null }, agora);
    if (depois === "SUSPENSO" || depois === "BLOQUEADO" || depois === "CANCELADO") {
      throw new BusinessRuleError(
        "O período pago já acabou. Contrate de novo em Assinatura.",
      );
    }

    // Regra 5: a mudança e o registro dela commitam juntos. Separados, uma
    // falha entre os dois deixava a assinatura reativada sem rastro na auditoria.
    await prisma.$transaction(async (tx) => {
      await tx.tenantSubscription.update({
        where: { id: sub.id },
        data: {
          cancelledAt: null,
          status: depois,
          statusSource: "AUTO",
          statusReason: null,
        },
      });
      await audit(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          actorEmail: ctx.session.email,
          action: "STATUS_CHANGE",
          entity: "TenantSubscription",
          entityId: sub.id,
          oldData: { cancelledAt: sub.cancelledAt, status: sub.status },
          newData: { cancelledAt: null, status: depois },
          ip: ctx.ip,
        },
        tx,
      );
    });

    return { status: depois };
  },
};
