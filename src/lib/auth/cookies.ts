import { cookies, headers } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessTokenMaxAgeSeconds } from "./jwt";

const refreshDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");

/**
 * O atributo `Secure` deve refletir o PROTOCOLO real da requisição, não o NODE_ENV.
 * - Em HTTPS (deploy atrás de proxy/Vercel → `x-forwarded-proto: https`): Secure = true.
 * - Em HTTP (dev, ou teste na LAN por IP, ex.: PWA no celular): Secure = false, senão o
 *   navegador DESCARTA o cookie (só o trata em contexto seguro) e a sessão nunca persiste.
 * Marcar Secure numa resposta HTTP não agrega segurança (o tráfego já é texto claro),
 * então condicionar ao protocolo é a regra correta e não enfraquece o HTTPS.
 */
async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0]!.trim().toLowerCase();
  return proto === "https";
}

async function cookieBase() {
  return {
    httpOnly: true,
    secure: await isHttpsRequest(),
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const [c, base] = await Promise.all([cookies(), cookieBase()]);
  c.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: accessTokenMaxAgeSeconds() });
  c.set(REFRESH_COOKIE, refreshToken, {
    ...base,
    maxAge: refreshDays * 24 * 60 * 60,
  });
}

export async function setAccessCookie(accessToken: string) {
  const [c, base] = await Promise.all([cookies(), cookieBase()]);
  c.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: accessTokenMaxAgeSeconds() });
}

export async function clearAuthCookies() {
  const [c, base] = await Promise.all([cookies(), cookieBase()]);
  c.set(ACCESS_COOKIE, "", { ...base, maxAge: 0 });
  c.set(REFRESH_COOKIE, "", { ...base, maxAge: 0 });
}

export async function readAccessCookie(): Promise<string | undefined> {
  const c = await cookies();
  return c.get(ACCESS_COOKIE)?.value;
}

export async function readRefreshCookie(): Promise<string | undefined> {
  const c = await cookies();
  return c.get(REFRESH_COOKIE)?.value;
}
