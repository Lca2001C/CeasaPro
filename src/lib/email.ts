import { Resend } from "resend";
import { logger } from "./logger";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "CeasaPro <nao-responda@ceasapro.com.br>";
const resend = apiKey ? new Resend(apiKey) : null;

/** Envia e-mail transacional. Sem RESEND_API_KEY (dev), apenas registra no log. */
export async function sendEmail(to: string, subject: string, html: string) {
  if (!resend) {
    logger.info({ to, subject }, "[DEV] E-mail não enviado (RESEND_API_KEY ausente)");
    logger.debug({ html }, "[DEV] Conteúdo do e-mail");
    return;
  }
  try {
    await resend.emails.send({ from, to, subject, html });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "Falha ao enviar e-mail");
  }
}

export function passwordResetEmail(link: string): { subject: string; html: string } {
  return {
    subject: "CeasaPro — Redefinir senha",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a7a3f">CeasaPro</h2>
        <p>Recebemos um pedido para redefinir sua senha.</p>
        <p><a href="${link}" style="display:inline-block;background:#1a7a3f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Redefinir minha senha</a></p>
        <p style="color:#666;font-size:13px">Se você não solicitou, ignore este e-mail. O link expira em 1 hora.</p>
      </div>`,
  };
}
