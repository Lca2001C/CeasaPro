import { SignJWT, jwtVerify } from "jose";
import type { UserRole, SubscriptionStatus, TenantStatus } from "@prisma/client";

export interface AccessPayload {
  sub: string; // userId
  role: UserRole;
  tenantId: string | null;
  email: string;
  name: string;
  mustChangePassword: boolean;
  tenantStatus?: TenantStatus | null;
  subStatus?: SubscriptionStatus | null;
}

const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL ?? "15m";

export function accessTokenMaxAgeSeconds(): number {
  const raw = ACCESS_TTL.trim();
  const match = raw.match(/^(\d+)([smhd])?$/i);
  if (!match) return 15 * 60;

  const value = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit === "d") return value * 24 * 60 * 60;
  if (unit === "h") return value * 60 * 60;
  if (unit === "m") return value * 60;
  return value;
}

function accessSecret(): Uint8Array {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error("JWT_ACCESS_SECRET não configurado");
  return new TextEncoder().encode(s);
}

export async function signAccess(payload: AccessPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(accessSecret());
}

/** Verifica e decodifica o access token. Retorna null se inválido/expirado. Edge-safe. */
export async function verifyAccess(token: string): Promise<AccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret());
    return {
      sub: String(payload.sub),
      role: payload.role as UserRole,
      tenantId: (payload.tenantId as string | null) ?? null,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      mustChangePassword: Boolean(payload.mustChangePassword),
      tenantStatus: (payload.tenantStatus as TenantStatus | null) ?? null,
      subStatus: (payload.subStatus as SubscriptionStatus | null) ?? null,
    };
  } catch {
    return null;
  }
}

export const ACCESS_COOKIE = "cp_access";
export const REFRESH_COOKIE = "cp_refresh";
