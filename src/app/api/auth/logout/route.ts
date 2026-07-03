import { clearAuthCookies, readRefreshCookie } from "@/lib/auth/cookies";
import { revokeRefreshToken } from "@/lib/auth/refresh";

export const runtime = "nodejs";

export async function POST() {
  const refresh = await readRefreshCookie();
  if (refresh) await revokeRefreshToken(refresh);
  await clearAuthCookies();
  return Response.json({ ok: true, data: null });
}
