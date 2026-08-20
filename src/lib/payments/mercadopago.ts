import { MercadoPagoConfig, Payment } from "mercadopago";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";

const accessToken = process.env.MP_ACCESS_TOKEN;

/** Validade do QR Code PIX gerado (depois disso o app gera uma nova cobrança). */
export const PIX_EXPIRATION_HOURS = 24;

export function isMercadoPagoConfigured(): boolean {
  return Boolean(accessToken());
}

function mpConfig(): MercadoPagoConfig {
  const token = accessToken();
  if (!token) throw new Error("MP_ACCESS_TOKEN não configurado");
  return new MercadoPagoConfig({ accessToken: token });
}

function paymentClient(): Payment {
  return new Payment(mpConfig());
}

function preferenceClient(): Preference {
  return new Preference(mpConfig());
}

/** URL pública da aplicação — usada em back_urls e notification_url. */
export function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export function webhookUrl(): string {
  return `${appUrl()}/api/webhooks/mercadopago`;
}

/**
 * Valida a configuração obrigatória em produção. Chamado nas rotas de billing
 * para falhar cedo e com mensagem clara, em vez de gerar cobrança inválida.
 */
export function assertMercadoPagoConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!process.env.MP_ACCESS_TOKEN) missing.push("MP_ACCESS_TOKEN");
  if (!process.env.MP_WEBHOOK_SECRET) missing.push("MP_WEBHOOK_SECRET");
  if (!process.env.APP_URL && !process.env.NEXT_PUBLIC_APP_URL) missing.push("APP_URL");
  if (missing.length > 0) {
    throw new Error(`Configuração do Mercado Pago incompleta: ${missing.join(", ")}`);
  }
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
}

/** Cria uma cobrança PIX no Mercado Pago. */
export async function createPixPayment(args: {
  amount: number;
  description: string;
  payerEmail: string;
  externalReference: string;
  expiresAt: Date;
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
    },
  });
  const tx = res.point_of_interaction?.transaction_data;
  return {
    mpPaymentId: String(res.id),
    status: String(res.status ?? "pending"),
    qrCode: tx?.qr_code ?? null,
    qrCodeBase64: tx?.qr_code_base64 ?? null,
    ticketUrl: tx?.ticket_url ?? null,
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
    paidAt: res.date_approved ? new Date(res.date_approved) : null,
  };
}

export type MpPayment = Awaited<ReturnType<typeof getPayment>>;

/**
 * Valida a assinatura HMAC do webhook do Mercado Pago.
 * Header x-signature: "ts=<ts>,v1=<hash>"; manifest = id:<dataId>;request-id:<reqId>;ts:<ts>;
 * Além do HMAC, o timestamp precisa ser recente (anti-replay).
 */
export function verifyWebhookSignature(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  now?: Date;
}): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      logger.error("MP_WEBHOOK_SECRET ausente em produção — webhook rejeitado.");
      return false;
    }
    logger.warn("MP_WEBHOOK_SECRET ausente — pulando verificação (apenas dev).");
    return true;
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

  // Anti-replay: o Mercado Pago envia o ts em segundos (epoch).
  const tsSeconds = Number(ts);
  if (!Number.isFinite(tsSeconds)) return false;
  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > WEBHOOK_MAX_SKEW_SECONDS) {
    logger.warn({ ts }, "Webhook Mercado Pago com timestamp fora da janela");
    return false;
  }

  const manifest = `id:${args.dataId};request-id:${args.xRequestId ?? ""};ts:${ts};`;
  const hmac = createHmac("sha256", secret).update(manifest).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
  } catch {
    return false;
  }
}
