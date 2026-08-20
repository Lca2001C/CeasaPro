import { timingSafeEqual } from "node:crypto";
import { BillingService } from "@/lib/services/billing.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Cron diário de billing:
 *  1. reconcilia cobranças PENDENTES (cura webhook perdido);
 *  2. recalcula o status das assinaturas (ATIVO/VENCIDO/SUSPENSO).
 * A ordem importa: reconciliar antes evita suspender quem já pagou.
 * Protegido por CRON_SECRET. Configurado em vercel.json.
 */
async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const reconciliacao = await BillingService.reconcilePendingPayments();
    const statuses = await BillingService.recomputeStatuses();
    return Response.json({ ok: true, reconciliacao, statuses });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "Erro no cron de billing");
    return Response.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
