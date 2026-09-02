import "server-only";
import webpush, { WebPushError } from "web-push";
import { prisma } from "@/lib/db/prisma";
import { describeError, logger } from "@/lib/logger";

/**
 * Envio de Web Push (lado servidor).
 *
 * Duas coisas que este módulo resolve e que não são óbvias:
 *
 * 1. **Inscrição morta é normal, e tem de ser removida.** O usuário desinstala o
 *    app, limpa os dados do site, ou o navegador expira a inscrição. O serviço de
 *    push responde **404/410** nesses casos, e isso não é erro do nosso lado — é
 *    o jeito dele dizer "esse destino não existe mais". Se não apagarmos a linha,
 *    o cron tenta o mesmo endpoint morto todo dia, para sempre.
 *
 * 2. **Falha de envio nunca derruba quem chamou.** Notificação é conveniência; o
 *    cron de billing e a operação não podem quebrar porque o FCM teve um soluço.
 *
 * Chaves VAPID vêm do ambiente e são obrigatórias para enviar. Sem elas o envio é
 * um no-op registrado no log — mesmo desenho do SMTP, que permite rodar em
 * desenvolvimento sem configurar serviço externo.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Para onde o clique leva. Caminho relativo do app. */
  url: string;
  /** Agrupa notificações do mesmo assunto: a nova substitui a anterior. */
  tag?: string;
}

let configurado: boolean | null = null;

/**
 * As chaves VAPID estão no ambiente?
 *
 * `VAPID_SUBJECT` é exigido pela especificação: um `mailto:` ou URL de contato,
 * para o serviço de push saber com quem falar se algo der errado no nosso lado.
 */
export function isPushConfigured(): boolean {
  if (configurado !== null) return configurado;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  configurado = Boolean(pub && priv && subject);
  if (configurado) {
    webpush.setVapidDetails(subject!, pub!, priv!);
  }
  return configurado;
}

export interface ResultadoEnvio {
  enviados: number;
  removidos: number;
  falhas: number;
}

/**
 * Envia para TODAS as inscrições de um usuário (ele pode ter celular e desktop).
 *
 * Devolve contagem em vez de lançar: quem chama normalmente é um cron, que precisa
 * seguir para o próximo usuário mesmo se este falhou.
 */
export async function enviarPushParaUsuario(
  userId: string,
  payload: PushPayload,
): Promise<ResultadoEnvio> {
  const resultado: ResultadoEnvio = { enviados: 0, removidos: 0, falhas: 0 };

  if (!isPushConfigured()) {
    logger.info({ userId, title: payload.title }, "[DEV] Push nao enviado (VAPID ausente)");
    return resultado;
  }

  const inscricoes = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (inscricoes.length === 0) return resultado;

  const corpo = JSON.stringify(payload);
  const mortas: string[] = [];

  await Promise.all(
    inscricoes.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          corpo,
          // 24h: um aviso de fiado vencido que chega 2 dias depois não ajuda, e
          // ocupar a fila do serviço de push com o que perdeu validade é ruído.
          { TTL: 24 * 60 * 60 },
        );
        resultado.enviados += 1;
      } catch (e) {
        // 404/410 = inscrição não existe mais. Removê-la é o comportamento
        // correto; insistir seria martelar um endereço morto todo dia.
        if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
          mortas.push(s.id);
          return;
        }
        resultado.falhas += 1;
        logger.warn(
          { err: describeError(e), userId, endpointHost: hostDoEndpoint(s.endpoint) },
          "Falha ao enviar push",
        );
      }
    }),
  );

  if (mortas.length > 0) {
    await prisma.pushSubscription
      .deleteMany({ where: { id: { in: mortas } } })
      .catch(() => undefined);
    resultado.removidos = mortas.length;
  }

  if (resultado.enviados > 0) {
    // Marca só quem aceitou: ajuda a distinguir inscrição morta de silenciosa.
    await prisma.pushSubscription
      .updateMany({
        where: { userId, id: { notIn: mortas } },
        data: { lastSentAt: new Date() },
      })
      .catch(() => undefined);
  }

  return resultado;
}

/**
 * Só o host do endpoint vai para o log.
 *
 * O endpoint inteiro é uma credencial: quem o tem (com as chaves) pode enviar
 * notificação para aquele aparelho. Host basta para saber de qual serviço de push
 * se trata (FCM, Mozilla, WNS) ao investigar uma falha.
 */
function hostDoEndpoint(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "desconhecido";
  }
}
