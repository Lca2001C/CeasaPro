import { signAccess } from "@/lib/auth/jwt";
import { buildAccessPayload } from "@/lib/auth/build-session";
import {
  readRefreshCookie,
  setAuthCookies,
  clearAuthCookies,
} from "@/lib/auth/cookies";
import { rotateRefreshToken } from "@/lib/auth/refresh";
import { clientIp, userAgent } from "@/lib/http/request";

export const runtime = "nodejs";

export async function POST() {
  const current = await readRefreshCookie();
  if (!current) {
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sessão expirada" } },
      { status: 401 },
    );
  }

  const rotated = await rotateRefreshToken(current, {
    ip: (await clientIp()) ?? undefined,
    userAgent: (await userAgent()) ?? undefined,
  });
  if (!rotated) {
    await clearAuthCookies();
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sessão inválida" } },
      { status: 401 },
    );
  }

  const payload = await buildAccessPayload(rotated.userId);
  if (!payload) {
    await clearAuthCookies();
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Conta indisponível" } },
      { status: 401 },
    );
  }

  const accessToken = await signAccess(payload);
  await setAuthCookies(accessToken, rotated.newToken);
  return Response.json({ ok: true, data: { role: payload.role } });
}
