import { prisma } from "@/lib/db/prisma";
import { revokeAllForUser } from "@/lib/auth/refresh";
import {
  createResetToken,
  hashResetToken,
  looksLikeResetToken,
  type ResetToken,
} from "@/lib/auth/reset-token";

/**
 * Ciclo de vida do token de redefinição de senha (parte que toca o banco).
 * Compartilhado por /api/auth/forgot, /api/auth/reset e pela página
 * /recuperar-senha/[token] — assim as três usam exatamente a mesma regra de
 * "token válido".
 */

/** Campos que o fluxo de redefinição precisa (nunca devolve passwordHash). */
const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  tenantId: true,
} as const;

export type ResettableUser = {
  id: string;
  email: string;
  name: string;
  tenantId: string | null;
};

/**
 * Usuário elegível a receber o link. Conta inativa ou excluída não recebe —
 * e o chamador responde a mesma mensagem genérica de qualquer jeito, para não
 * revelar quais e-mails existem (enumeração de contas).
 */
export function findResettableUserByEmail(email: string): Promise<ResettableUser | null> {
  return prisma.user.findFirst({
    where: { email, active: true, deletedAt: null },
    select: SAFE_SELECT,
  });
}

/**
 * Gera um token novo e o grava (hash + expiração).
 * Sobrescrever é intencional: pedir um link novo invalida o anterior.
 */
export async function issueResetToken(userId: string): Promise<ResetToken> {
  const token = createResetToken();
  await prisma.user.update({
    where: { id: userId },
    data: { resetTokenHash: token.tokenHash, resetTokenExpiresAt: token.expiresAt },
  });
  return token;
}

/** Usuário do token cru, se o token existir, não tiver expirado e a conta estiver ativa. */
export async function findUserByResetToken(raw: string): Promise<ResettableUser | null> {
  if (!looksLikeResetToken(raw)) return null;
  return prisma.user.findFirst({
    where: {
      resetTokenHash: hashResetToken(raw),
      resetTokenExpiresAt: { gt: new Date() },
      active: true,
      deletedAt: null,
    },
    select: SAFE_SELECT,
  });
}

/**
 * Efetiva a nova senha: grava o hash, queima o token (uso único), limpa a
 * exigência de troca no primeiro acesso e derruba todas as sessões abertas.
 *
 * A limpeza do token é condicionada ao próprio hash (`updateMany` com o hash no
 * where): se dois cliques no mesmo link chegarem juntos, só o primeiro afeta
 * uma linha — o segundo vê 0 e recebe "link inválido".
 */
export async function consumeResetToken(args: {
  userId: string;
  rawToken: string;
  passwordHash: string;
}): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: {
      id: args.userId,
      resetTokenHash: hashResetToken(args.rawToken),
      resetTokenExpiresAt: { gt: new Date() },
    },
    data: {
      passwordHash: args.passwordHash,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      mustChangePassword: false,
    },
  });
  if (result.count === 0) return false;
  // Senha trocada => todo refresh token antigo morre (sessão roubada perde acesso).
  await revokeAllForUser(args.userId);
  return true;
}
