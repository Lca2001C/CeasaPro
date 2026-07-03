import { MercadoPagoConfig, Payment } from "mercadopago";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/logger";

const accessToken = process.env.MP_ACCESS_TOKEN;

export function isMercadoPagoConfigured(): boolean {
  return Boolean(accessToken);
}

function paymentClient(): Payment {
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN não configurado");
  return new Payment(new MercadoPagoConfig({ accessToken }));
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
}): Promise<PixCharge> {
  const client = paymentClient();
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
