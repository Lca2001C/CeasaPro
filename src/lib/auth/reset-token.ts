import { createHash, randomBytes } from "node:crypto";

/**
 * Token de redefinição de senha — parte pura (sem banco), para poder ser
 * testada isoladamente. O acesso ao banco fica em `password-reset.ts`.
 *
 * Regras de segurança:
 * - O token cru (que vai no link do e-mail) NUNCA é gravado; guardamos só o
 *   SHA-256. Um dump do banco não permite redefinir senha de ninguém.
 * - SHA-256 (e não Argon2) é adequado aqui porque o token tem 256 bits de
 *   entropia: não há dicionário para atacar, e a comparação precisa ser rápida.
 * - Uso único: ao redefinir, o hash é apagado (`password-reset.ts`).
 */

/** Validade do link enviado por e-mail. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/** 32 bytes em base64url = 43 caracteres. */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export interface ResetToken {
  /** Vai no link do e-mail. Não é persistido. */
  raw: string;
  /** SHA-256 do token cru — é isto que fica em `users.resetTokenHash`. */
  tokenHash: string;
  expiresAt: Date;
}

export function createResetToken(now: Date = new Date()): ResetToken {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, tokenHash: hashResetToken(raw), expiresAt: resetTokenExpiry(now) };
}

export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function resetTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
}

/**
 * Filtro de formato antes de ir ao banco. Evita consulta (e log) para lixo
 * óbvio — bot varrendo /recuperar-senha/<qualquer coisa>.
 */
export function looksLikeResetToken(raw: string | undefined | null): boolean {
  return typeof raw === "string" && TOKEN_PATTERN.test(raw);
}

/**
 * Mascara o e-mail para exibição na tela de redefinição ("ma***@dominio.com").
 * Quem abriu o link já tem acesso à caixa; mostrar de qual conta se trata evita
 * o usuário redefinir a senha errada quando tem mais de um e-mail.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const user = email.slice(0, at);
  const domain = email.slice(at);
  if (user.length <= 2) return `${user[0]}***${domain}`;
  return `${user.slice(0, 2)}${"*".repeat(Math.min(user.length - 2, 6))}${domain}`;
}
