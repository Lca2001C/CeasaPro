import { BillingService } from "@/lib/services/billing.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recalcula o status das assinaturas (ATIVO/VENCIDO/SUSPENSO) a partir das datas.
 * Protegido por CRON_SECRET. Configure no Vercel Cron para rodar diariamente.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const result = await BillingService.recomputeStatuses();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "Erro no cron de billing");
    return Response.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
