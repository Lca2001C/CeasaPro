import { after } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/mercadopago";
import { BillingService } from "@/lib/services/billing.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  // O id do pagamento vem em data.id (corpo) ou ?data.id / ?id (query).
  const dataId =
    (body as { data?: { id?: string } }).data?.id ??
    url.searchParams.get("data.id") ??
    url.searchParams.get("id");
  // O Mercado Pago identifica o evento em `type` (webhooks) ou `topic` (IPN legado).
  const type =
    (body as { type?: string }).type ??
    url.searchParams.get("type") ??
    url.searchParams.get("topic");

  const valid = verifyWebhookSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId: dataId ? String(dataId) : null,
  });
  if (!valid) {
    // Assinatura HMAC inválida ou timestamp fora da janela (replay).
    logger.warn(
      { dataId, type, hasSignature: Boolean(req.headers.get("x-signature")) },
      "Webhook Mercado Pago rejeitado: assinatura inválida ou expirada",
    );
    return new Response("invalid signature", { status: 401 });
  }

  // Só nos interessa evento de pagamento — aprovação, estorno e chargeback
  // chegam todos como "payment", mudando apenas o status consultado na API.
  if (type && type !== "payment") return Response.json({ ok: true });
  if (!dataId) return Response.json({ ok: true });

  // Confirma a entrega na hora e processa depois da resposta: o Mercado Pago
  // reenvia o evento se demorarmos, e o cron de reconciliação cura o que falhar.
  const mpPaymentId = String(dataId);
  after(async () => {
    try {
      const result = await BillingService.handleWebhook(mpPaymentId);
      logger.info({ mpPaymentId, result }, "Webhook Mercado Pago processado");
    } catch (e) {
      logger.error(
        { mpPaymentId, err: e instanceof Error ? e.message : String(e) },
        "Erro no webhook MP — será tratado pela reconciliação",
      );
    }
  });
  return Response.json({ ok: true });
}
