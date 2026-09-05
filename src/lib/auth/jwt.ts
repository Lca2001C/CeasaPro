import { SignJWT, jwtVerify } from "jose";
import { chaveDerivada, CHAVE_ACCESS } from "./keys";
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
  /** Módulos opcionais do plano. Sempre emitido; sem ele, nada é liberado. */
  modules?: string[];
  /**
   * Contadores de revogação, do USUÁRIO (`sev`) e da EMPRESA (`tev`).
   *
   * Conferidos contra o banco nos wrappers de escrita: qualquer incremento
   * invalida na hora as sessões emitidas antes, em vez de esperar o access
   * token vencer. É o que faz logout global, exclusão de usuário, bloqueio de
   * empresa e troca de senha valerem imediatamente.
   */
  sev?: number;
  tev?: number;
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

/**
 * Identidade do access token.
 *
 * Três barreiras independentes contra confusão de tipo de token — chave
 * derivada com rótulo próprio, `aud` e `typ`. Qualquer uma sozinha já mataria o
 * bug em que o JWT de state do OAuth era aceito como sessão; as três juntas
 * custam quatro linhas.
 */
export const EMISSOR = "ceasapro";
export const PUBLICO_ACCESS = "ceasapro:app";
export const TIPO_ACCESS = "access";

export async function signAccess(payload: AccessPayload): Promise<string> {
  return new SignJWT({ ...payload, typ: TIPO_ACCESS })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuer(EMISSOR)
    .setAudience(PUBLICO_ACCESS)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(await chaveDerivada(CHAVE_ACCESS));
}

/** Verifica e decodifica o access token. Retorna null se inválido/expirado. Edge-safe. */
export async function verifyAccess(token: string): Promise<AccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, await chaveDerivada(CHAVE_ACCESS), {
      // `jose` já restringe a família pelo tipo da chave, mas dizer o algoritmo
      // é uma linha e tira a dedução do caminho.
      algorithms: ["HS256"],
      issuer: EMISSOR,
      audience: PUBLICO_ACCESS,
      requiredClaims: ["sub", "exp", "typ"],
      // Celular com relógio fora de hora é comum no balcão.
      clockTolerance: 5,
    });
    if (payload.typ !== TIPO_ACCESS) return null;
    return {
      sub: String(payload.sub),
      role: payload.role as UserRole,
      tenantId: (payload.tenantId as string | null) ?? null,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      mustChangePassword: Boolean(payload.mustChangePassword),
      tenantStatus: (payload.tenantStatus as TenantStatus | null) ?? null,
      subStatus: (payload.subStatus as SubscriptionStatus | null) ?? null,
      modules: Array.isArray(payload.modules)
        ? (payload.modules as string[])
        : undefined,
      sev: typeof payload.sev === "number" ? payload.sev : undefined,
      tev: typeof payload.tev === "number" ? payload.tev : undefined,
    };
  } catch {
    return null;
  }
}

export const ACCESS_COOKIE = "cp_access";
export const REFRESH_COOKIE = "cp_refresh";
