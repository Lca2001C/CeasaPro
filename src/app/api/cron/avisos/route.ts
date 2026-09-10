import { timingSafeEqual } from "node:crypto";
import { PushAvisosService } from "@/lib/services/push-avisos.service";
import { describeError, logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 60 s é o teto do plano Hobby.
 *
 * Mantido mesmo depois de a importação dos boletins sair daqui: o envio de push
 * percorre todas as empresas e todas as inscrições de aparelho, e o padrão da
 * função serverless (~10 s) é curto para isso.
 */
export const maxDuration = 60;

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
      A importação dos boletins ficava AQUI e passou para o cron de billing.

      O motivo é o horário, não a arquitetura. Este cron roda 09:30 UTC = 06:30
      BRT, que é a hora certa para o push — o box abre de madrugada e o dono lê o
      aviso antes de começar — e a hora ERRADA para buscar boletim: às 6h30 a
      praça ainda não publicou o do dia, então o recuo de datas pegava sempre o de
      ontem, e o boletim de hoje só aparecia na manhã seguinte.

      O plano Hobby limita a 2 agendamentos, então não havia um terceiro horário
      a pedir. A saída foi trocar de carona: a importação foi para o cron de
      billing, que passou a rodar 13:30 BRT. O push continua às 6h30, com o
      boletim que a importação da tarde anterior já gravou.
    */
    return Response.json({ ok: true, avisos });
  } catch (e) {
    logger.error({ err: describeError(e) }, "Cron de avisos por push falhou");
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// A Vercel dispara cron com GET; o POST fica para disparo manual.
export const GET = handle;
export const POST = handle;
