import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { signAccess } from "@/lib/auth/jwt";
import { buildAccessPayload } from "@/lib/auth/build-session";
import { setAuthCookies } from "@/lib/auth/cookies";
import { createRefreshToken, revokeAllForUser } from "@/lib/auth/refresh";
import { changePasswordSchema } from "@/lib/validations/auth";
import { rateLimitDb, respostaDeLimite } from "@/lib/security/rate-limit-db";
import { audit } from "@/lib/audit";
import { clientIp, userAgent } from "@/lib/http/request";
import { errorResponse } from "@/lib/http/error-response";

export const runtime = "nodejs";

/** Falha inesperada sai no envelope padrão, não como 500 cru. */
export async function POST(req: Request) {
  try {
    return await trocarSenha(req);
  } catch (e) {
    return errorResponse(e);
  }
}

async function trocarSenha(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Nao autenticado" } },
      { status: 401 },
    );
  }
  const ip = (await clientIp()) ?? "unknown";

  const rl = await rateLimitDb(`change-password:${ip}:${session.sub}`, {
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!rl.ok) {
    return respostaDeLimite(rl);
  }

  const body = await req.json().catch(() => ({}));
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION", message: "Dados invalidos" } },
      { status: 422 },
    );
  }

  const user = await prisma.user.findFirst({
    where: { id: session.sub, active: true, deletedAt: null },
  });
  if (!user) {
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sessao invalida" } },
      { status: 401 },
    );
  }

  const okPass = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
  if (!okPass) {
    return Response.json(
      { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Senha atual incorreta." } },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);

  // Senha nova, revogação de TODAS as sessões (refresh + `sessionEpoch`) e a
  // auditoria num commit só (regra 5). Separadas, um soluço do banco entre a
  // troca e a revogação deixava a senha nova gravada e o invasor — o motivo de
  // quase toda troca de senha — ainda dentro com o refresh token dele.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });
    await revokeAllForUser(user.id, "PASSWORD", tx);
    await audit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        actorEmail: user.email,
        action: "PASSWORD_CHANGE",
        entity: "User",
        entityId: user.id,
        newData: { mustChangePassword: false },
        ip,
      },
      tx,
    );
  });

  // DEPOIS do commit: a revogação acima derrubaria também este token novo, e a
  // pessoa seria deslogada no instante em que trocou a senha.
  const refreshToken = await createRefreshToken(user.id, {
    ip,
    userAgent: (await userAgent()) ?? undefined,
  });
  const payload = await buildAccessPayload(user.id);
  if (!payload) {
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Conta indisponivel" } },
      { status: 401 },
    );
  }
  const accessToken = await signAccess(payload);
  await setAuthCookies(accessToken, refreshToken);

  const redirectTo = user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
  return Response.json({ ok: true, data: { redirectTo } });
}
