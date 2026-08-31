import { createHash, randomBytes } from "node:crypto";

/**
 * Token de confirmação de e-mail do cadastro público — parte pura (sem banco),
 * para poder ser testada isoladamente. O acesso ao banco fica em
 * `signup.service.ts`. Mesma divisão de `reset-token.ts` / `password-reset.ts`.
 *
 * Regras de segurança (idênticas às do token de redefinição, e pelos mesmos
 * motivos):
 * - O token cru (que vai no link do e-mail) NUNCA é gravado; guardamos só o
 *   SHA-256. Um dump do banco não permite confirmar conta de ninguém.
 * - SHA-256 (e não Argon2) é adequado porque o token tem 256 bits de entropia:
 *   não há dicionário para atacar, e a comparação precisa ser rápida.
 * - Uso único: ao confirmar, o hash é apagado.
 *
 * A validade é maior que a do reset (60 min) porque o contexto é outro: quem
 * pede redefinição de senha está na frente do computador agora; quem se cadastra
 * pode abrir o e-mail no dia seguinte, e um link morto ali é um cliente perdido.
 */

export const VERIFY_TOKEN_TTL_HOURS = 24;

/** 32 bytes em base64url = 43 caracteres. */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export interface VerifyToken {
  /** Vai no link do e-mail. Não é persistido. */
  raw: string;
  /** SHA-256 do token cru — é isto que fica em `users.verifyTokenHash`. */
  tokenHash: string;
  expiresAt: Date;
}

export function createVerifyToken(now: Date = new Date()): VerifyToken {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, tokenHash: hashVerifyToken(raw), expiresAt: verifyTokenExpiry(now) };
}

export function hashVerifyToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function verifyTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * Filtro de formato antes de ir ao banco. Evita consulta (e log) para lixo
 * óbvio — bot varrendo /cadastro/confirmar/<qualquer coisa>.
 */
export function looksLikeVerifyToken(raw: string | undefined | null): boolean {
  return typeof raw === "string" && TOKEN_PATTERN.test(raw);
}
