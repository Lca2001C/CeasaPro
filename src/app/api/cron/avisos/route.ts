import { timingSafeEqual } from "node:crypto";
import { PushAvisosService } from "@/lib/services/push-avisos.service";
import { describeError, logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mesma verificação do cron de billing: comparação em tempo constante para o
 * secret não ser descoberto byte a byte pelo tempo de resposta.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || !auth) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(auth);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Cron diário de avisos por notificação (fiado vencido, despesa a vencer,
 * higienização a pagar).
 *
 * Rota SEPARADA do cron de billing de propósito: cobrança é receita, notificação é
 * conveniência. Uma falha do serviço de push não pode entrar no caminho que
 * reconcilia pagamento e recalcula assinatura.
 *
 * Protegido por CRON_SECRET. Agendado em vercel.json.
 */
async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const avisos = await PushAvisosService.enviarAvisosDiarios();
    logger.info(avisos, "Cron de avisos por push concluido");
    return Response.json({ ok: true, avisos });
  } catch (e) {
    logger.error({ err: describeError(e) }, "Cron de avisos por push falhou");
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// A Vercel dispara cron com GET; o POST fica para disparo manual.
export const GET = handle;
export const POST = handle;
