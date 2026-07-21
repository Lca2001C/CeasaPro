import { MercadoPagoConfig, Payment } from "mercadopago";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";

const accessToken = process.env.MP_ACCESS_TOKEN;

/** Validade do QR Code PIX gerado (depois disso o app gera uma nova cobrança). */
export const PIX_EXPIRATION_HOURS = 24;

export function isMercadoPagoConfigured(): boolean {
  return Boolean(accessToken);
}

function paymentClient(): Payment {
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN não configurado");
  return new Payment(new MercadoPagoConfig({ accessToken }));
}

/** URL pública do webhook — só é enviada ao MP se for https (o MP rejeita localhost/http). */
function notificationUrl(): string | undefined {
  const base = process.env.APP_URL;
  if (base?.startsWith("https://")) return `${base.replace(/\/$/, "")}/api/webhooks/mercadopago`;
  return undefined;
}

/** Data de expiração no formato exigido pelo MP (ISO com offset, ex.: 2026-07-10T18:00:00.000-03:00). */
function expirationDate(hours: number): { iso: string; date: Date } {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const local = new Date(date.getTime() + offsetMin * 60 * 1000)
    .toISOString()
    .replace("Z", "");
  return { iso: `${local}${sign}${hh}:${mm}`, date };
}

export interface PixCharge {
  mpPaymentId: string;
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: Date;
}

/**
 * Cria uma cobrança PIX no Mercado Pago.
 * - Idempotency-Key por chamada: evita cobrança duplicada se a requisição HTTP for repetida.
 * - notification_url: garante o webhook mesmo sem configurar o painel do MP (apenas em https).
 * - date_of_expiration: o QR expira em PIX_EXPIRATION_HOURS; o app renova cobranças vencidas.
 */
export async function createPixPayment(args: {
  amount: number;
  description: string;
  payerEmail: string;
  externalReference: string;
}): Promise<PixCharge> {
  const client = paymentClient();
  const expiration = expirationDate(PIX_EXPIRATION_HOURS);
  const res = await client.create({
    body: {
      transaction_amount: args.amount,
      description: args.description,
      payment_method_id: "pix",
      payer: { email: args.payerEmail },
      external_reference: args.externalReference,
      notification_url: notificationUrl(),
      date_of_expiration: expiration.iso,
    },
    requestOptions: { idempotencyKey: randomUUID() },
  });
  const tx = res.point_of_interaction?.transaction_data;
  return {
    mpPaymentId: String(res.id),
    status: String(res.status ?? "pending"),
    qrCode: tx?.qr_code ?? null,
    qrCodeBase64: tx?.qr_code_base64 ?? null,
    ticketUrl: tx?.ticket_url ?? null,
    expiresAt: expiration.date,
  };
}

/**
 * Cria um pagamento com CARTÃO no Mercado Pago a partir do token do Card Brick.
 * PCI: o servidor recebe apenas o `token` (gerado no browser) — nunca número/CVV/validade.
 * O status pode vir "approved" na hora, ou "in_process"/"pending" (3DS/análise) → o webhook resolve.
 */
export async function createCardPayment(args: {
  amount: number;
  description: string;
  payerEmail: string;
  externalReference: string;
  token: string;
  paymentMethodId: string;
  installments: number;
}): Promise<{ mpPaymentId: string; status: string }> {
  const client = paymentClient();
  const res = await client.create({
    body: {
      transaction_amount: args.amount,
      token: args.token,
      description: args.description,
      installments: args.installments,
      payment_method_id: args.paymentMethodId,
      payer: { email: args.payerEmail },
      external_reference: args.externalReference,
      notification_url: notificationUrl(),
    },
    requestOptions: { idempotencyKey: randomUUID() },
  });
  return {
    mpPaymentId: String(res.id),
    status: String(res.status ?? "pending"),
  };
}

/** Busca um pagamento no Mercado Pago (fonte da verdade do status). */
export async function getPayment(id: string) {
  const client = paymentClient();
  const res = await client.get({ id });
  return {
    id: String(res.id),
    status: String(res.status ?? ""),
    externalReference: res.external_reference ?? null,
    amount: res.transaction_amount ?? 0,
    method: res.payment_method_id ?? null,
  };
}

/**
 * Valida a assinatura HMAC do webhook do Mercado Pago.
 * Header x-signature: "ts=<ts>,v1=<hash>"; manifest = id:<dataId>;request-id:<reqId>;ts:<ts>;
 */
export function verifyWebhookSignature(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn("MP_WEBHOOK_SECRET ausente — pulando verificação (apenas dev).");
    return process.env.NODE_ENV !== "production";
  }
  if (!args.xSignature || !args.dataId) return false;

  const parts = Object.fromEntries(
    args.xSignature.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const manifest = `id:${args.dataId};request-id:${args.xRequestId ?? ""};ts:${ts};`;
  const hmac = createHmac("sha256", secret).update(manifest).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
  } catch {
    return false;
  }
}
