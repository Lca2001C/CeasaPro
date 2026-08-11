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
  const type = (body as { type?: string }).type ?? url.searchParams.get("type");

  const valid = verifyWebhookSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId: dataId ? String(dataId) : null,
  });
  if (!valid) {
    logger.warn("Webhook Mercado Pago com assinatura inválida");
    return new Response("invalid signature", { status: 401 });
  }

  // Só nos interessa evento de pagamento.
  if (type && type !== "payment") return Response.json({ ok: true });
  if (!dataId) return Response.json({ ok: true });

  try {
    const result = await BillingService.handleWebhook(String(dataId));
    // "nao_encontrado" é conclusivo (cobrança de outra instalação): 200 encerra.
    return Response.json({ ok: true, result });
  } catch (e) {
    // Erro transiente (rede/MP/banco): devolve 500 para o Mercado Pago reenviar.
    // O cron de reconciliação é a segunda rede de segurança.
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "Erro no webhook MP");
    return Response.json({ ok: false }, { status: 500 });
  }
}
