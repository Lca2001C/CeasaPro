import { timingSafeEqual } from "node:crypto";
import { PushAvisosService } from "@/lib/services/push-avisos.service";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
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

    /*
      Importação dos boletins de cotação, como SUB-TAREFA desta rota.

      Não ganha cron próprio porque `vercel.json` já tem 2 agendamentos, que é o
      teto do plano Hobby — um terceiro faria o deploy falhar. Entra aqui, e não
      no cron de billing, pela mesma regra que separou as duas rotas: cobrança é
      receita, e raspagem de site de terceiro não pode encostar no caminho que
      reconcilia pagamento.

      O `.catch()` é o que garante isso na prática: a fonte é um sistema legado
      que não nos deve nada, e o dia em que ela cair não pode ser o dia em que os
      avisos por push param. Mesmo padrão das seis sub-tarefas de `cron/billing`.
    */
    const cotacoes = await CotacoesImportService.importarTodasAsCentrais()
      .then(async (r) => {
        // A defasagem é conferida DEPOIS de importar: assim ela enxerga o
        // resultado desta execução, e não o de ontem.
        const defasadas = await CotacoesImportService.verificarDefasagem();
        return { centrais: r.centrais, defasadas: defasadas.length };
      })
      .catch((e) => {
        logger.error({ err: describeError(e) }, "Importacao de cotacoes falhou");
        return { erro: "falhou" };
      });
    logger.info({ cotacoes }, "Sub-tarefa de cotacoes concluida");

    return Response.json({ ok: true, avisos, cotacoes });
  } catch (e) {
    logger.error({ err: describeError(e) }, "Cron de avisos por push falhou");
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// A Vercel dispara cron com GET; o POST fica para disparo manual.
export const GET = handle;
export const POST = handle;
