import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

/**
 * Envio de e-mail transacional por **SMTP** (Gmail por padrão).
 *
 * Substitui o Resend. O contrato público (`sendEmail`, `SendEmailResult`,
 * `SendEmailOptions`) foi mantido de propósito: nenhum chamador precisou mudar.
 *
 * Gmail exige **senha de app** (Conta Google › Segurança › Verificação em duas
 * etapas › Senhas de app) — a senha normal da conta não autentica em SMTP.
 */
const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? "465");
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;

/**
 * O Gmail reescreve o remetente para a conta autenticada quando o `From` é de
 * outro endereço, então o padrão é o próprio `SMTP_USER`. `EMAIL_FROM` continua
 * valendo para quem usa outro servidor SMTP ou um alias verificado no Gmail.
 */
const from =
  process.env.EMAIL_FROM ??
  (SMTP_USER ? `CeasaPro <${SMTP_USER}>` : "CeasaPro <nao-responda@ceasapro.com.br>");
// Endereço de resposta monitorado (opcional). Ter um reply-to real ajuda na reputação/anti-spam.
const defaultReplyTo = process.env.EMAIL_REPLY_TO || undefined;

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
  /**
   * Rótulos do envio. Viram cabeçalhos `X-Entity-Ref-*`, úteis para filtrar no
   * servidor de e-mail. (No Resend eram tags de métrica; o contrato ficou.)
   */
  tags?: { name: string; value: string }[];
  /** Cabeçalhos extras (ex.: Idempotency-Key, References). */
  headers?: Record<string, string>;
  /** Se informado, adiciona List-Unsubscribe (uso em e-mails não estritamente transacionais). */
  unsubscribeUrl?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASSWORD);
}

/**
 * Conexão SMTP reaproveitada entre invocações.
 *
 * Em serverless a instância fica quente entre requisições, e abrir uma conexão
 * TLS nova a cada e-mail custa mais que o próprio envio. `pool: false` porque
 * a função pode ser congelada a qualquer momento — um pool de conexões ociosas
 * ficaria pendurado do lado do Gmail.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    // 465 = TLS implícito; 587 = STARTTLS (o nodemailer negocia sozinho).
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    // Sem isso, uma indisponibilidade do SMTP seguraria a função até o timeout
    // da plataforma, e o usuário ficaria olhando para uma tela travada.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

const MAX_ATTEMPTS = 3; // 1 tentativa + 2 retries
const RETRY_BASE_MS = 300;

/**
 * Envia um e-mail transacional por SMTP.
 *
 * - Sem SMTP_USER/SMTP_PASSWORD, apenas registra no log e retorna { ok:true }
 *   (no-op) — é o que permite rodar em dev sem caixa de e-mail.
 * - Nunca lança: retorna SendEmailResult para o chamador decidir.
 * - Reenvia (backoff) apenas em falhas transitórias (rede, timeout, 4xx do SMTP,
 *   limite de envio). Erro permanente — credencial inválida, destinatário
 *   recusado — não repete: insistir só queimaria a reputação da conta.
 */
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  opts: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const recipients = Array.isArray(to) ? to : [to];
  const mailer = getTransporter();

  if (!mailer) {
    logger.info(
      { to: recipients, subject },
      "[DEV] E-mail nao enviado (SMTP_USER/SMTP_PASSWORD ausentes)",
    );
    return { ok: true, id: "dev-noop" };
  }

  const headers: Record<string, string> = { ...opts.headers };
  if (opts.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${opts.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  // Os rótulos viram cabeçalhos: dá para filtrar/monitorar no servidor de
  // e-mail sem precisar de um painel de provedor.
  for (const tag of opts.tags ?? []) {
    headers[`X-Entity-Ref-${tag.name}`] = tag.value;
  }

  const payload = {
    from,
    to: recipients,
    subject,
    html,
    // Multipart texto+HTML: clientes que preferem texto puro têm fallback e a mensagem "cheira" menos a spam.
    text: opts.text ?? htmlToText(html),
    replyTo: opts.replyTo ?? defaultReplyTo,
    headers: Object.keys(headers).length ? headers : undefined,
  };

  let lastError = "erro desconhecido";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const info = await mailer.sendMail(payload);
      logger.debug(
        { id: info.messageId, to: recipients, subject, attempt },
        "E-mail enviado",
      );
      return { ok: true, id: info.messageId ?? "unknown" };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const code = (e as { responseCode?: number; code?: string }).responseCode;
      const nome = (e as { code?: string }).code;
      if (!isRetriableSmtpError(nome, lastError, code) || attempt === MAX_ATTEMPTS) {
        logger.error(
          { err: lastError, code: code ?? nome, to: recipients, subject, attempt },
          "Falha ao enviar e-mail",
        );
        return { ok: false, error: lastError };
      }
    }

    // Backoff exponencial simples antes do próximo retry.
    await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  return { ok: false, error: lastError };
}

/**
 * Vale retry?
 *
 * SMTP separa por código: **4xx é temporário** (caixa cheia, limite de envio,
 * servidor ocupado) e **5xx é permanente** (autenticação, destinatário
 * inexistente). Repetir um 5xx não muda o resultado e conta contra a reputação
 * do remetente, então só o 4xx e as falhas de rede voltam.
 */
export function isRetriableSmtpError(
  code: string | undefined,
  message: string,
  responseCode?: number,
): boolean {
  if (responseCode !== undefined) {
    return responseCode >= 400 && responseCode < 500;
  }
  const rede = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ESOCKET",
    "EDNS",
    "EAI_AGAIN",
    "ECONNECTION",
  ]);
  if (code && rede.has(code)) return true;
  return isRetriableMessage(code, message);
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
