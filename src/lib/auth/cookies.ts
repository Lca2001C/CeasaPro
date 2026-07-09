import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessTokenMaxAgeSeconds } from "./jwt";

const isProd = process.env.NODE_ENV === "production";
const refreshDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");

const base = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/",
};

export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const c = await cookies();
  c.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: accessTokenMaxAgeSeconds() });
  c.set(REFRESH_COOKIE, refreshToken, {
    ...base,
    maxAge: refreshDays * 24 * 60 * 60,
  });
}

export async function setAccessCookie(accessToken: string) {
  const c = await cookies();
  c.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: accessTokenMaxAgeSeconds() });
}

export async function clearAuthCookies() {
  const c = await cookies();
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
