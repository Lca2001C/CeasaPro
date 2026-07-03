import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { signAccess } from "@/lib/auth/jwt";
import { buildAccessPayload } from "@/lib/auth/build-session";
import { setAuthCookies } from "@/lib/auth/cookies";
import { createRefreshToken } from "@/lib/auth/refresh";
import { loginSchema } from "@/lib/validations/auth";
import { rateLimit } from "@/lib/security/rate-limit";
import { audit } from "@/lib/audit";
import { clientIp, userAgent } from "@/lib/http/request";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = (await clientIp()) ?? "unknown";
  const body = await req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION", message: "Dados inválidos" } },
      { status: 422 },
    );
  }
  const { email, password } = parsed.data;

  const rl = rateLimit(`login:${ip}:${email}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  if (!rl.ok) {
    return Response.json(
      {
        ok: false,
        error: { code: "RATE_LIMIT", message: "Muitas tentativas. Tente novamente em alguns minutos." },
      },
      { status: 429 },
    );
  }

  const user = await prisma.user.findFirst({
    where: { email, active: true, deletedAt: null },
  });

  // Mensagem genérica — nunca revelar se o e-mail existe.
  const invalid = () =>
    Response.json(
      { ok: false, error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha incorretos." } },
      { status: 401 },
    );

  if (!user) return invalid();
  const okPass = await verifyPassword(user.passwordHash, password);
  if (!okPass) return invalid();

  const payload = await buildAccessPayload(user.id);
  if (!payload) return invalid();

  const accessToken = await signAccess(payload);
  const refreshToken = await createRefreshToken(user.id, {
    ip,
    userAgent: (await userAgent()) ?? undefined,
  });
  await setAuthCookies(accessToken, refreshToken);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    actorEmail: user.email,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    ip,
  });

  const redirectTo = user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
  return Response.json({ ok: true, data: { redirectTo, mustChangePassword: user.mustChangePassword } });
}
