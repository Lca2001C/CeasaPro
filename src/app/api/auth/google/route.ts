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

  // Folgado como o balde só por IP do login: o Wi-Fi do CEASA põe dezenas de
  // boxes atrás de um IP, e com 10 em 15 min o 11º via "tente de novo" — o que
  // só piorava. Com IP desconhecido fica de fora (todo mundo no mesmo balde).
  const ip = await clientIp();
  const rl = ip
    ? await rateLimitDb(`login-google:${ip}`, { limit: 60, windowMs: 15 * 60 * 1000 })
    : null;
  if (rl && !rl.ok) {
    const code = rl.indisponivel ? "google-falhou" : "google-muitas-tentativas";
    return Response.redirect(new URL(loginComErroGoogle(code), req.url));
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
