import { cookies, headers } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessTokenMaxAgeSeconds } from "./jwt";

const refreshDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");

/**
 * `Secure` LIGADO por padrão — o padrão falha seguro.
 *
 * Antes isto era decidido só pelo `x-forwarded-proto` da requisição. O raciocínio
 * era correto (marcar Secure numa resposta HTTP não protege nada, e o navegador
 * descarta cookie Secure fora de contexto seguro), mas a fonte era ruim: sem um
 * proxy que normalize o header, quem escreve `x-forwarded-proto` é o cliente — e
 * um valor `http` fazia o cookie de sessão ser gravado sem `Secure`.
 *
 * Agora só um flag explícito de ambiente reabre a exceção, para o caso real que a
 * motivou: testar na LAN por IP (http://192.168.x.x, PWA no celular), onde o
 * navegador não considera a origem segura. Nesse modo o protocolo ainda é lido do
 * header — mas do hop confiável (à direita), não do primeiro elemento.
 *
 * `http://localhost` é contexto seguro para os navegadores atuais, então o
 * desenvolvimento local normal funciona com `Secure` ligado, sem flag nenhum.
 */
const PERMITE_COOKIE_INSEGURO = process.env.ALLOW_INSECURE_COOKIES === "1";

async function isSecureRequest(): Promise<boolean> {
  if (!PERMITE_COOKIE_INSEGURO) return true;
  const h = await headers();
  const cadeia = (h.get("x-forwarded-proto") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return cadeia[cadeia.length - 1] === "https";
}

async function cookieBase() {
  return {
    httpOnly: true,
    secure: await isSecureRequest(),
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
