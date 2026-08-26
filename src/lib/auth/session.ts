import "server-only";
import { readAccessCookie } from "./cookies";
import { verifyAccess, type AccessPayload } from "./jwt";
import {
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/http/app-error";
import type { UserRole } from "@prisma/client";

export type Session = AccessPayload;

/** Lê e verifica o access token do cookie. Retorna null se não logado/inválido. */
export async function getSession(): Promise<Session | null> {
  const token = await readAccessCookie();
  if (!token) return null;
  return verifyAccess(token);
}

export async function requireAuth(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new UnauthorizedError();
  return s;
}

export async function requireRole(...roles: UserRole[]): Promise<Session> {
  const s = await requireAuth();
  if (!roles.includes(s.role)) throw new ForbiddenError();
  return s;
}

export async function requireSuperAdmin(): Promise<Session> {
  return requireRole("SUPER_ADMIN");
}

/**
 * Garante um usuário com empresa (tenantId presente).
 *
 * Vale para OWNER e para o SUPER_ADMIN **que tem ambiente próprio**: ele
 * também precisa usar o sistema (testar, demonstrar, conferir um cálculo), e
 * isso acontece dentro de um tenant dele — nunca no de um cliente. O
 * `tenantId` continua vindo da sessão, então o isolamento por empresa é o
 * mesmo de sempre: um super-admin sem ambiente provisionado não passa daqui.
 *
 * A verificação de assinatura ativa fica no wrapper (assertActive).
 */
export async function requireTenant(): Promise<{ session: Session; tenantId: string }> {
  const s = await requireAuth();
  if (!s.tenantId || (s.role !== "OWNER" && s.role !== "SUPER_ADMIN")) {
    throw new ForbiddenError("Acesso restrito à área da empresa.");
  }
  return { session: s, tenantId: s.tenantId };
}
