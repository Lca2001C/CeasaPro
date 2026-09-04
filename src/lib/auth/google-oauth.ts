import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { absoluteUrl } from "@/lib/app-url";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Login com Google (OAuth 2 + PKCE, redirecionamento no servidor).
 *
 * Não usa o SDK JavaScript do Google de propósito: o CSP do app só aceita
 * script/`connect` da própria origem, e um botão que navega para o Google
 * não precisa furar isso. O callback volta em `/api/auth/google/callback`,
 * que já é rota pública (`/api/auth`).
 */

export const GOOGLE_OAUTH_COOKIE = "cp_google_oauth";
export const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

const COOKIE_TTL_SEGUNDOS = 10 * 60;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface GoogleOAuthState {
  state: string;
  verifier: string;
  next: string | null;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export type GoogleLoginErro =
  | "google-indisponivel"
  | "google-cancelado"
  | "google-falhou"
  | "google-inativo";

export const MENSAGENS_ERRO_GOOGLE: Record<GoogleLoginErro, string> = {
  "google-indisponivel":
    "Entrar com Google ainda não está disponível. Use e-mail e senha.",
  "google-cancelado": "Entrada com Google cancelada.",
  "google-falhou":
    "Não foi possível entrar com o Google. Tente de novo ou use e-mail e senha.",
  "google-inativo":
    "Não foi possível entrar com o Google. Tente de novo ou use e-mail e senha.",
};

export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function googleCallbackUrl(): string {
  return absoluteUrl("/api/auth/google/callback");
}

export function loginComErroGoogle(code: GoogleLoginErro): string {
  return `/login?erro=${code}`;
}

function oauthSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET não configurado");
  return new TextEncoder().encode(s);
}

export function novoPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

export function urlDeAutorizacaoGoogle(
  cfg: GoogleOAuthConfig,
  pkce: { challenge: string; state: string },
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: googleCallbackUrl(),
    response_type: "code",
    scope: "openid email profile",
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
}

export async function assinarEstadoOAuth(dados: GoogleOAuthState): Promise<string> {
  return new SignJWT({
    state: dados.state,
    verifier: dados.verifier,
    next: dados.next,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_TTL_SEGUNDOS}s`)
    .sign(oauthSecret());
}

export async function lerEstadoOAuth(token: string | undefined): Promise<GoogleOAuthState | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, oauthSecret());
    const state = typeof payload.state === "string" ? payload.state : "";
    const verifier = typeof payload.verifier === "string" ? payload.verifier : "";
    if (!state || !verifier) return null;
    const nextRaw = typeof payload.next === "string" ? payload.next : null;
    return {
      state,
      verifier,
      next: nextRaw ? safeRedirectPath(nextRaw, "") || null : null,
    };
  } catch {
    return null;
  }
}

export function oauthCookieMaxAge(): number {
  return COOKIE_TTL_SEGUNDOS;
}

export async function trocarCodigoPorPerfil(
  cfg: GoogleOAuthConfig,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleProfile | null> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: googleCallbackUrl(),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const tokenRes = await fetchImpl(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) return null;
  const tokens = (await tokenRes.json().catch(() => null)) as {
    access_token?: string;
  } | null;
  if (!tokens?.access_token) return null;

  const infoRes = await fetchImpl(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) return null;
  const info = (await infoRes.json().catch(() => null)) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  } | null;
  const sub = info?.sub?.trim();
  const email = info?.email?.trim().toLowerCase();
  if (!sub || !email || !info?.email_verified) return null;
  const name = info.name?.trim() || email.split("@")[0] || "Cliente";
  return { sub, email, emailVerified: true, name };
}
