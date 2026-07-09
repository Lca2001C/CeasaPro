import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { signAccess } from "@/lib/auth/jwt";
import { buildAccessPayload } from "@/lib/auth/build-session";
import { setAuthCookies } from "@/lib/auth/cookies";
import { createRefreshToken, revokeAllForUser } from "@/lib/auth/refresh";
import { changePasswordSchema } from "@/lib/validations/auth";
import { rateLimit } from "@/lib/security/rate-limit";
import { audit } from "@/lib/audit";
import { clientIp, userAgent } from "@/lib/http/request";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Nao autenticado" } },
      { status: 401 },
    );
  }
  const ip = (await clientIp()) ?? "unknown";

  const rl = rateLimit(`change-password:${ip}:${session.sub}`, {
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!rl.ok) {
    return Response.json(
      {
        ok: false,
        error: { code: "RATE_LIMIT", message: "Muitas tentativas. Tente novamente em alguns minutos." },
      },
      { status: 429 },
    );
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
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: false,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    },
  });

  await revokeAllForUser(user.id);
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

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    actorEmail: user.email,
    action: "PASSWORD_CHANGE",
    entity: "User",
    entityId: user.id,
    newData: { mustChangePassword: false },
    ip,
  });

  const redirectTo = user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
  return Response.json({ ok: true, data: { redirectTo } });
}
