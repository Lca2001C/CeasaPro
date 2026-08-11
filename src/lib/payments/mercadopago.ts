import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/logger";

/**
 * Integração Mercado Pago — PIX (cobrança direta) + Checkout Pro (cartão).
 * O token é lido a cada chamada (e não no import) para não congelar a
 * configuração no cold start de ambientes serverless.
 */

/** Tolerância do timestamp do webhook — protege contra replay de assinatura. */
export const WEBHOOK_MAX_SKEW_SECONDS = 300;

function accessToken(): string | undefined {
  return process.env.MP_ACCESS_TOKEN;
}

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

export interface PixCharge {
  mpPaymentId: string;
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: Date | null;
}

/**
 * Cria uma cobrança PIX no Mercado Pago.
 * `externalReference` é usado como chave de idempotência: repetir a chamada
 * devolve a MESMA cobrança em vez de criar uma segunda.
 */
export async function createPixPayment(args: {
  amount: number;
  description: string;
  payerEmail: string;
  externalReference: string;
  expiresAt: Date;
}): Promise<PixCharge> {
  const client = paymentClient();
  const res = await client.create({
    body: {
      transaction_amount: args.amount,
      description: args.description,
      payment_method_id: "pix",
      payer: { email: args.payerEmail },
      external_reference: args.externalReference,
      notification_url: webhookUrl(),
      date_of_expiration: args.expiresAt.toISOString(),
    },
    requestOptions: { idempotencyKey: `pix:${args.externalReference}` },
  });
  const tx = res.point_of_interaction?.transaction_data;
  return {
    mpPaymentId: String(res.id),
    status: String(res.status ?? "pending"),
    qrCode: tx?.qr_code ?? null,
    qrCodeBase64: tx?.qr_code_base64 ?? null,
    ticketUrl: tx?.ticket_url ?? null,
    expiresAt: res.date_of_expiration ? new Date(res.date_of_expiration) : args.expiresAt,
  };
}

export interface CardCheckout {
  preferenceId: string;
  initPoint: string | null;
}

/**
 * Cria uma preferência de Checkout Pro (cartão de crédito/débito).
 * O pagamento resultante chega pelo mesmo webhook, correlacionado por
 * `external_reference`.
 */
export async function createCardPreference(args: {
  amount: number;
  description: string;
  payerEmail: string;
  externalReference: string;
  expiresAt: Date;
}): Promise<CardCheckout> {
  const client = preferenceClient();
  const base = appUrl();
  const res = await client.create({
    body: {
      items: [
        {
          id: args.externalReference,
          title: args.description,
          quantity: 1,
          currency_id: "BRL",
          unit_price: args.amount,
        },
      ],
      payer: { email: args.payerEmail },
      external_reference: args.externalReference,
      notification_url: webhookUrl(),
      back_urls: {
        success: `${base}/assinatura?pagamento=sucesso`,
        pending: `${base}/assinatura?pagamento=pendente`,
        failure: `${base}/assinatura?pagamento=falha`,
      },
      auto_return: "approved",
      binary_mode: true,
      expires: true,
      expiration_date_to: args.expiresAt.toISOString(),
      payment_methods: { excluded_payment_types: [{ id: "ticket" }] },
    },
    requestOptions: { idempotencyKey: `card:${args.externalReference}` },
  });
  return {
    preferenceId: String(res.id),
    initPoint: res.init_point ?? res.sandbox_init_point ?? null,
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
