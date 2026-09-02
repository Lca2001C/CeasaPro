import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

const refreshDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Cria um refresh token opaco, guarda apenas o hash, e devolve o token cru. */
export async function createRefreshToken(
  userId: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<string> {
  const raw = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt,
      userAgent: meta?.userAgent,
      ip: meta?.ip,
    },
  });
  return raw;
}

/**
 * Rotaciona: valida o token atual, revoga-o e emite um novo.
 * Retorna { userId, newToken } ou null se inválido/expirado/revogado.
 */
export async function rotateRefreshToken(
  raw: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<{ userId: string; newToken: string } | null> {
  const tokenHash = hashToken(raw);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    return null;
  }
  const newRaw = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashToken(newRaw),
        expiresAt,
        userAgent: meta?.userAgent,
        ip: meta?.ip,
      },
    }),
  ]);
  return { userId: existing.userId, newToken: newRaw };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoga todas as sessões de um usuário (logout global / troca de senha). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoga todas as sessões de uma empresa (bloqueio imediato pelo super-admin). */
export async function revokeAllForTenant(tenantId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { user: { tenantId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Quanto tempo um token revogado ainda é guardado.
 *
 * Não se apaga na hora porque a linha revogada é a evidência de reuso: se um
 * token já rotacionado reaparecer, é sinal de cópia roubada. Sete dias é prazo
 * suficiente para essa detecção sem acumular a tabela para sempre.
 */
const DIAS_DE_RETENCAO = 7;

/**
 * Remove sessões que não servem mais para nada: vencidas, ou revogadas há mais
 * de uma semana.
 *
 * Existe porque nada limpava esta tabela. Cada login e cada renovação criam uma
 * linha — e a renovação passou a acontecer enquanto o app está aberto (ver
 * `SessaoViva`), então o crescimento deixou de ser desprezível. Roda no cron
 * diário, junto das outras manutenções.
 */
export async function purgeDeadRefreshTokens(now: Date = new Date()): Promise<number> {
  const limiteRevogados = new Date(now.getTime() - DIAS_DE_RETENCAO * 24 * 60 * 60 * 1000);
  const { count } = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { lt: limiteRevogados } },
      ],
    },
  });
  return count;
}
