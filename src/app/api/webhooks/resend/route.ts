import { verifyResendSignature } from "@/lib/email/webhook";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Formato dos eventos enviados pelo Resend (campos relevantes). */
interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    from?: string;
    subject?: string;
    // Presente em email.bounced / email.complained:
    bounce?: { type?: string; message?: string };
  };
}

export async function POST(req: Request) {
  // A verificação Svix exige o corpo CRU (não reserializar). Por isso req.text(), não req.json().
  const raw = await req.text();

  const valid = verifyResendSignature({
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
    payload: raw,
    secret: process.env.RESEND_WEBHOOK_SECRET,
  });
  if (!valid) {
    logger.warn("Webhook Resend com assinatura inválida");
    return new Response("invalid signature", { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw) as ResendEvent;
  } catch {
    // Corpo inválido mas assinatura ok: apenas ignore (200 evita reenvio em loop).
    logger.warn("Webhook Resend com corpo não-JSON");
    return Response.json({ ok: true });
  }

  try {
    const emailId = event.data?.email_id;
    const to = event.data?.to;

    switch (event.type) {
      case "email.delivered":
        logger.info({ emailId, to }, "Resend: e-mail entregue");
        break;

      case "email.bounced":
        logger.warn({ emailId, to, bounce: event.data?.bounce }, "Resend: bounce");
        // TODO(supressão): marcar o(s) destinatário(s) como inválidos numa tabela
        // de supressão para não reenviar (evita dano à reputação de envio).
        break;

      case "email.complained":
        logger.warn({ emailId, to }, "Resend: marcado como spam (complaint)");
        // TODO(supressão): remover o destinatário de comunicações não essenciais.
        break;

      case "email.delivery_delayed":
        logger.info({ emailId, to }, "Resend: entrega adiada");
        break;

      case "email.opened":
      case "email.clicked":
        logger.debug({ emailId, to, type: event.type }, "Resend: engajamento");
        break;

      default:
        logger.debug({ type: event.type, emailId }, "Resend: evento não tratado");
    }
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "Erro no webhook Resend");
    // Responde 200 mesmo assim para o Resend não reenviar em loop; o erro fica logado.
  }

  return Response.json({ ok: true });
}
