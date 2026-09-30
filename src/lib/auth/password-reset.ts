import { prisma } from "@/lib/db/prisma";
import { revokeAllForUser } from "@/lib/auth/refresh";
import { audit } from "@/lib/audit";
import { trialEndFrom } from "@/lib/billing/status";
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
 *
 * Senha nova, revogação das sessões (refresh + `sessionEpoch`) e a auditoria
 * `PASSWORD_RESET` saem no MESMO commit (regra 5). Antes a revogação vinha
 * depois da transação: um soluço do banco entre as duas deixava a senha trocada
 * e os refresh tokens antigos vivos — justamente o que a pessoa queria matar ao
 * redefinir a senha de uma conta invadida.
 */
export async function consumeResetToken(args: {
  userId: string;
  rawToken: string;
  passwordHash: string;
  /** IP de quem redefiniu, para a auditoria. */
  ip?: string | null;
}): Promise<boolean> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: {
        id: args.userId,
        resetTokenHash: hashResetToken(args.rawToken),
        resetTokenExpiresAt: { gt: now },
      },
      data: {
        passwordHash: args.passwordHash,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
        mustChangePassword: false,
      },
    });
    if (result.count === 0) return false;

    // O link chegou na caixa: isso COMPROVA o e-mail tanto quanto o link de
    // confirmação. Sem isto, quem não recebeu a confirmação (spam, SMTP fora)
    // não tinha caminho para o teste grátis — `/conta/suspensa` o manda para cá.
    // Só cadastro público pendente tem `emailVerifiedAt` nulo (a migration do
    // trial preencheu a base; o admin cria já confirmado), e o filtro do trial
    // é o mesmo de `SignupService.confirmEmail`: nunca concede duas vezes.
    const user = await tx.user.findUniqueOrThrow({
      where: { id: args.userId },
      select: { emailVerifiedAt: true, tenantId: true, email: true },
    });
    if (user.emailVerifiedAt === null) {
      await tx.user.update({
        where: { id: args.userId },
        data: { emailVerifiedAt: now, verifyTokenHash: null, verifyTokenExpiresAt: null },
      });
      if (user.tenantId) {
        const trialEndsAt = trialEndFrom(now);
        const concedido = await tx.tenantSubscription.updateMany({
          where: { tenantId: user.tenantId, trialEndsAt: null, activatedAt: null },
          data: { status: "TRIAL", trialEndsAt },
        });
        if (concedido.count > 0) {
          await audit(
            {
              tenantId: user.tenantId,
              userId: args.userId,
              actorEmail: user.email,
              action: "UPDATE",
              entity: "TenantSubscription",
              entityId: user.tenantId,
              newData: {
                status: "TRIAL",
                trialEndsAt: trialEndsAt.toISOString(),
                origem: "recuperar-senha",
              },
            },
            tx,
          );
        }
      }
    }

    // Senha trocada => todo refresh token antigo morre (sessão roubada perde
    // acesso), e o `sessionEpoch` sobe junto, derrubando os access tokens.
    await revokeAllForUser(args.userId, "PASSWORD", tx);
    await audit(
      {
        tenantId: user.tenantId,
        userId: args.userId,
        actorEmail: user.email,
        action: "PASSWORD_RESET",
        entity: "User",
        entityId: args.userId,
        newData: { passwordReset: true, sessionsRevoked: true },
        ip: args.ip ?? null,
      },
      tx,
    );
    return true;
  });
}
