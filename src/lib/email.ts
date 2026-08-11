import { Resend } from "resend";
import { logger } from "./logger";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "CeasaPro <nao-responda@ceasapro.com.br>";
const resend = apiKey ? new Resend(apiKey) : null;

/** Envia e-mail transacional. Sem RESEND_API_KEY (dev), apenas registra no log. */
export async function sendEmail(to: string, subject: string, html: string) {
  if (!resend) {
    logger.info({ to, subject }, "[DEV] E-mail nao enviado (RESEND_API_KEY ausente)");
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
    subject: "CeasaPro - Redefinir senha",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a7a3f">CeasaPro</h2>
        <p>Recebemos um pedido para redefinir sua senha.</p>
        <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1a7a3f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Redefinir minha senha</a></p>
        <p style="color:#666;font-size:13px">Se voce nao solicitou, ignore este e-mail. O link expira em 1 hora.</p>
      </div>`,
  };
}

export function welcomeOwnerEmail(args: {
  ownerName: string;
  tradeName: string;
  email: string;
  temporaryPassword: string;
  appUrl: string;
}): { subject: string; html: string } {
  return {
    subject: "Bem-vindo ao CeasaPro",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#1a7a3f">CeasaPro</h2>
        <p>Ola, ${escapeHtml(args.ownerName)}.</p>
        <p>A empresa <strong>${escapeHtml(args.tradeName)}</strong> foi criada no CeasaPro.</p>
        <p>Acesse com as credenciais abaixo. Por seguranca, a senha devera ser trocada no primeiro acesso.</p>
        <div style="background:#f6f7f8;border:1px solid #e1e4e8;border-radius:8px;padding:12px;margin:16px 0">
          <p style="margin:0 0 8px"><strong>E-mail:</strong> ${escapeHtml(args.email)}</p>
          <p style="margin:0"><strong>Senha temporaria:</strong> ${escapeHtml(args.temporaryPassword)}</p>
        </div>
        <p><a href="${escapeHtml(args.appUrl)}" style="display:inline-block;background:#1a7a3f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Acessar CeasaPro</a></p>
      </div>`,
  };
}

export function paymentApprovedEmail(args: {
  ownerName: string;
  tradeName: string;
  amount: string;
  referenceMonth: string;
  nextDueDate: Date;
  appUrl: string;
}): { subject: string; html: string } {
  const valor = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(args.amount));
  const vencimento = new Intl.DateTimeFormat("pt-BR").format(args.nextDueDate);
  return {
    subject: `CeasaPro - Pagamento confirmado (${args.referenceMonth})`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#1a7a3f">CeasaPro</h2>
        <p>Ola, ${escapeHtml(args.ownerName)}.</p>
        <p>Recebemos o pagamento da mensalidade de <strong>${escapeHtml(args.tradeName)}</strong>.</p>
        <div style="background:#f6f7f8;border:1px solid #e1e4e8;border-radius:8px;padding:12px;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Mes de referencia:</strong> ${escapeHtml(args.referenceMonth)}</p>
          <p style="margin:0 0 8px"><strong>Valor pago:</strong> ${escapeHtml(valor)}</p>
          <p style="margin:0"><strong>Proximo vencimento:</strong> ${escapeHtml(vencimento)}</p>
        </div>
        <p><a href="${escapeHtml(args.appUrl)}" style="display:inline-block;background:#1a7a3f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Acessar CeasaPro</a></p>
        <p style="color:#666;font-size:13px">Seu acesso ja esta liberado. Obrigado!</p>
      </div>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
