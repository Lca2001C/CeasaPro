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

/**
 * E-mail com o link de redefinição de senha.
 *
 * O link aparece duas vezes de propósito: como botão e como URL em texto. Vários
 * clientes (e gateways corporativos) desmontam o botão ou bloqueiam o clique, e
 * sem a URL visível o usuário fica sem saída.
 */
export function passwordResetEmail(
  link: string,
  expiresInMinutes = 60,
): { subject: string; html: string } {
  const validade =
    expiresInMinutes % 60 === 0
      ? `${expiresInMinutes / 60} hora${expiresInMinutes > 60 ? "s" : ""}`
      : `${expiresInMinutes} minutos`;
  const href = escapeHtml(link);
  return {
    subject: "CeasaPro - Redefinir senha",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a7a3f">CeasaPro</h2>
        <p>Recebemos um pedido para redefinir a senha da sua conta.</p>
        <p><a href="${href}" style="display:inline-block;background:#1a7a3f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Redefinir minha senha</a></p>
        <p style="color:#666;font-size:13px">Se o botao nao funcionar, copie e cole este endereco no navegador:</p>
        <p style="font-size:13px;word-break:break-all"><a href="${href}" style="color:#1a7a3f">${href}</a></p>
        <p style="color:#666;font-size:13px">O link vale por ${escapeHtml(validade)} e pode ser usado uma unica vez. Se voce nao pediu a troca, ignore este e-mail — sua senha atual continua valendo.</p>
      </div>`,
  };
}

/**
 * Confirmação enviada DEPOIS que a senha foi trocada. É o aviso que permite à
 * pessoa reagir caso a troca não tenha sido ela (conta comprometida).
 */
export function passwordChangedEmail(args: {
  loginUrl: string;
  changedAt?: Date;
}): { subject: string; html: string } {
  const quando = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(args.changedAt ?? new Date());
  return {
    subject: "CeasaPro - Sua senha foi alterada",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a7a3f">CeasaPro</h2>
        <p>A senha da sua conta foi alterada em <strong>${escapeHtml(quando)}</strong>.</p>
        <p>Por seguranca, todos os dispositivos conectados foram desconectados.</p>
        <p><a href="${escapeHtml(args.loginUrl)}" style="display:inline-block;background:#1a7a3f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Entrar no CeasaPro</a></p>
        <p style="color:#666;font-size:13px">Se nao foi voce que trocou a senha, redefina-a imediatamente em "Esqueci minha senha" e fale com o suporte.</p>
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
  const vencimento = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  }).format(args.nextDueDate);
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

/**
 * Lembrete enviado alguns dias ANTES do vencimento da mensalidade.
 *
 * Sem ele o cliente só descobria o vencimento ao ser bloqueado, no meio do
 * expediente — que é o pior momento possível para quem usa o sistema no balcão.
 */
export function subscriptionDueSoonEmail(args: {
  ownerName: string;
  tradeName: string;
  amount: string;
  dueDate: Date;
  daysAhead: number;
  graceDays: number;
  appUrl: string;
}): { subject: string; html: string } {
  const valor = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(args.amount));
  const vencimento = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  }).format(args.dueDate);
  const prazo =
    args.daysAhead === 1 ? "amanhã" : `em ${args.daysAhead} dias`;
  const tolerancia =
    args.graceDays > 0
      ? `Depois do vencimento ainda há ${args.graceDays} dia(s) de tolerância; passado esse prazo o acesso é bloqueado até a regularização.`
      : "Passado o vencimento o acesso é bloqueado até a regularização.";
  const link = escapeHtml(`${args.appUrl}/assinatura`);
  return {
    subject: `CeasaPro - Sua mensalidade vence ${prazo}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#1a7a3f">CeasaPro</h2>
        <p>Ola, ${escapeHtml(args.ownerName)}.</p>
        <p>A mensalidade de <strong>${escapeHtml(args.tradeName)}</strong> vence <strong>${escapeHtml(prazo)}</strong>.</p>
        <div style="background:#f6f7f8;border:1px solid #e1e4e8;border-radius:8px;padding:12px;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Vencimento:</strong> ${escapeHtml(vencimento)}</p>
          <p style="margin:0"><strong>Valor:</strong> ${escapeHtml(valor)}</p>
        </div>
        <p><a href="${link}" style="display:inline-block;background:#1a7a3f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Pagar agora</a></p>
        <p style="color:#666;font-size:13px">Se o botao nao funcionar, copie e cole este endereco no navegador:</p>
        <p style="font-size:13px;word-break:break-all"><a href="${link}" style="color:#1a7a3f">${link}</a></p>
        <p style="color:#666;font-size:13px">Aceitamos PIX, cartao de credito e cartao de debito. ${escapeHtml(tolerancia)}</p>
        <p style="color:#666;font-size:13px">Se voce ja pagou, pode ignorar este aviso.</p>
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
