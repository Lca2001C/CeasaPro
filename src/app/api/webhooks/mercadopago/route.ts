import { after } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/mercadopago";
import { BillingService } from "@/lib/services/billing.service";
import { describeError, logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  // O id chega no corpo (`data.id`) e/ou na query (`?data.id`). A assinatura é
  // calculada sobre o da QUERY, mas nem toda notificação a traz — por isso os
  // dois vão como candidatos para a verificação.
  const idCorpo = (body as { data?: { id?: string | number } }).data?.id;
  const idQuery = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const dataIdQuery = idQuery ? String(idQuery) : null;
  const dataIdCorpo = idCorpo !== undefined && idCorpo !== null ? String(idCorpo) : null;

  // O Mercado Pago identifica o evento em `type` (webhooks) ou `topic` (IPN legado).
  const type =
    (body as { type?: string }).type ??
    url.searchParams.get("type") ??
    url.searchParams.get("topic");

  // Devolve QUAL id fechou o HMAC — e é só esse que será processado. Confiar no
  // id do corpo aqui permitiria apresentar assinatura válida para um pagamento e
  // fazer o servidor processar outro.
  const dataId = verifyWebhookSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId: dataIdQuery ?? dataIdCorpo,
    dataIdAlt: dataIdCorpo,
  });
  if (!dataId) {
    // Assinatura HMAC inválida ou timestamp fora da janela (replay).
    logger.warn(
      {
        dataIdQuery,
        dataIdCorpo,
        type,
        hasSignature: Boolean(req.headers.get("x-signature")),
      },
      "Webhook Mercado Pago rejeitado: assinatura inválida ou expirada",
    );
    return new Response("invalid signature", { status: 401 });
  }

  // Só nos interessa evento de pagamento — aprovação, estorno e chargeback
  // chegam todos como "payment", mudando apenas o status consultado na API.
  if (type && type !== "payment") return Response.json({ ok: true });

  // Confirma a entrega na hora e processa depois da resposta: o Mercado Pago
  // reenvia o evento se demorarmos, e o cron de reconciliação cura o que falhar.
  const mpPaymentId = dataId;
  after(async () => {
    try {
      const result = await BillingService.handleWebhook(mpPaymentId);
      logger.info({ mpPaymentId, result }, "Webhook Mercado Pago processado");
    } catch (e) {
      logger.error(
        { mpPaymentId, err: describeError(e) },
        "Erro no webhook MP — será tratado pela reconciliação",
      );
    }
  });
  return Response.json({ ok: true });
}
