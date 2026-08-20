import { Resend } from "resend";
import { logger } from "./logger";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "CeasaPro <nao-responda@ceasapro.com.br>";
// Endereço de resposta monitorado (opcional). Ter um reply-to real ajuda na reputação/anti-spam.
const defaultReplyTo = process.env.EMAIL_REPLY_TO || undefined;
const resend = apiKey ? new Resend(apiKey) : null;

/** Resultado do envio. Permite ao chamador decidir o que fazer sem precisar de try/catch. */
export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** Opções extras de envio. Todas opcionais — o uso mais simples continua sendo sendEmail(to, subject, html). */
export interface SendEmailOptions {
  /** Versão texto puro. Se ausente, é derivada do HTML (corpo multipart texto+HTML reduz spam). */
  text?: string;
  /** Endereço de resposta. Default: EMAIL_FROM/EMAIL_REPLY_TO. */
  replyTo?: string;
  /** Tags para segmentar métricas no painel do Resend. */
  tags?: { name: string; value: string }[];
  /** Cabeçalhos extras (ex.: Idempotency-Key, References). */
  headers?: Record<string, string>;
  /** Se informado, adiciona List-Unsubscribe (uso em e-mails não estritamente transacionais). */
  unsubscribeUrl?: string;
}

const MAX_ATTEMPTS = 3; // 1 tentativa + 2 retries
const RETRY_BASE_MS = 300;

/**
 * Envia um e-mail transacional via Resend.
 *
 * - Em dev, sem RESEND_API_KEY, apenas registra no log e retorna { ok:true } (no-op).
 * - Nunca lança: retorna SendEmailResult para o chamador decidir.
 * - Reenvia (backoff) apenas em falhas transitórias (rede/5xx/rate limit); 4xx não repete.
 */
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  opts: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const recipients = Array.isArray(to) ? to : [to];

  if (!resend) {
    logger.info({ to: recipients, subject }, "[DEV] E-mail nao enviado (RESEND_API_KEY ausente)");
    return { ok: true, id: "dev-noop" };
  }

  const headers: Record<string, string> = { ...opts.headers };
  if (opts.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${opts.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const payload = {
    from,
    to: recipients,
    subject,
    html,
    // Multipart texto+HTML: clientes que preferem texto puro têm fallback e a mensagem "cheira" menos a spam.
    text: opts.text ?? htmlToText(html),
    replyTo: opts.replyTo ?? defaultReplyTo,
    tags: opts.tags,
    headers: Object.keys(headers).length ? headers : undefined,
  };

  let lastError = "erro desconhecido";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await resend.emails.send(payload);

      if (error) {
        // O SDK devolve o erro no corpo (não lança). Só reenvia se for transitório.
        lastError = error.message;
        if (!isRetriableMessage(error.name, error.message) || attempt === MAX_ATTEMPTS) {
          logger.error({ err: error.message, to: recipients, subject, attempt }, "Falha ao enviar e-mail");
          return { ok: false, error: error.message };
        }
      } else if (data?.id) {
        logger.debug({ id: data.id, to: recipients, subject, attempt }, "E-mail enviado");
        return { ok: true, id: data.id };
      } else {
        return { ok: true, id: "unknown" };
      }
    } catch (e) {
      // Exceções aqui são tipicamente de rede/timeout — sempre transitórias.
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt === MAX_ATTEMPTS) {
        logger.error({ err: lastError, to: recipients, subject, attempt }, "Falha ao enviar e-mail");
        return { ok: false, error: lastError };
      }
    }

    // Backoff exponencial simples antes do próximo retry.
    await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  return { ok: false, error: lastError };
}

/** Erros que valem retry: rede, timeout, rate limit (429) e 5xx do provedor. */
function isRetriableMessage(name?: string, message?: string): boolean {
  const haystack = `${name ?? ""} ${message ?? ""}`.toLowerCase();
  return (
    haystack.includes("rate limit") ||
    haystack.includes("timeout") ||
    haystack.includes("timed out") ||
    haystack.includes("econn") ||
    haystack.includes("network") ||
    haystack.includes("temporarily") ||
    haystack.includes("try again") ||
    /\b5\d\d\b/.test(haystack) ||
    haystack.includes("429")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Converte HTML em texto puro razoável para o fallback multipart (não precisa ser perfeito). */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>(\n)?/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
