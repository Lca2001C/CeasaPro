import { NextRequest } from "next/server";
import { rateLimitDb } from "@/lib/security/rate-limit-db";
import { clientIp } from "@/lib/http/request";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { setGoogleOAuthCookie } from "@/lib/auth/cookies";
import {
  assinarEstadoOAuth,
  googleOAuthConfig,
  loginComErroGoogle,
  novoPkce,
  urlDeAutorizacaoGoogle,
} from "@/lib/auth/google-oauth";

export const runtime = "nodejs";

/**
 * Inicia o redirecionamento para o Google.
 *
 * GET de propósito: o botão da tela de login é um link, não um POST, para o
 * navegador seguir o 302 até o Google sem JavaScript (CSP `strict-dynamic`).
 */
export async function GET(req: NextRequest) {
  const cfg = googleOAuthConfig();
  if (!cfg) {
    return Response.redirect(new URL(loginComErroGoogle("google-indisponivel"), req.url));
  }

  const ip = (await clientIp()) ?? "unknown";
  const rl = await rateLimitDb(`login-google:${ip}`, {
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rl.ok) {
    return Response.redirect(new URL(loginComErroGoogle("google-falhou"), req.url));
  }

  const next = safeRedirectPath(req.nextUrl.searchParams.get("next"), "");
  const pkce = novoPkce();
  const token = await assinarEstadoOAuth({
    state: pkce.state,
    verifier: pkce.verifier,
    next: next || null,
  });
  await setGoogleOAuthCookie(token);

  return Response.redirect(urlDeAutorizacaoGoogle(cfg, pkce));
}
