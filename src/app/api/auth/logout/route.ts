import { clearAuthCookies, readRefreshCookie } from "@/lib/auth/cookies";
import { revokeRefreshToken } from "@/lib/auth/refresh";
import { recusaDeOutraOrigem } from "@/lib/http/mesma-origem";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Escrita de outro site (login/logout CSRF) — ver `mesma-origem.ts`.
  const recusa = recusaDeOutraOrigem(req, false);
  if (recusa) return recusa;
  const refresh = await readRefreshCookie();
  if (refresh) await revokeRefreshToken(refresh);
  await clearAuthCookies();
  return Response.json({ ok: true, data: null });
}
