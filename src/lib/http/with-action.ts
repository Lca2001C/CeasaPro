import type { ZodType } from "zod";
import { requireTenant, requireSuperAdmin, type Session } from "@/lib/auth/session";
import { accessDecision } from "@/lib/billing/status";
import { requireModule, type OptionalModuleKey } from "@/lib/plan/modules";
import { ForbiddenError, PaymentRequiredError } from "./app-error";
import { ok, toActionResult, type ActionResult } from "./action-result";
import { clientIp } from "./request";

export interface TenantCtx {
  session: Session;
  tenantId: string;
  userId: string;
  ip: string | null;
}

export interface AdminCtx {
  session: Session;
  userId: string;
  ip: string | null;
}

function assertActive(session: Session) {
  if (session.mustChangePassword) {
    throw new ForbiddenError("Troque sua senha para continuar.");
  }
  if (accessDecision(session.tenantStatus, session.subStatus) === "blocked") {
    throw new PaymentRequiredError();
  }
}

function assertPasswordReady(session: Session) {
  if (session.mustChangePassword) {
    throw new ForbiddenError("Troque sua senha para continuar.");
  }
}

/**
 * Wrapper de Server Action da EMPRESA (OWNER).
 * Centraliza: sessão + tenant + assinatura ativa + validação Zod + tratamento de erro.
 * O handler recebe input já validado e um ctx com o tenantId confiável (da sessão).
 */
export function withTenantAction<I, O>(opts: {
  schema?: ZodType<I>;
  /** Se informado, exige que o plano da empresa inclua este módulo (defense in depth). */
  module?: OptionalModuleKey;
  handler: (input: I, ctx: TenantCtx) => Promise<O>;
}) {
  return async (raw?: unknown): Promise<ActionResult<O>> => {
    try {
      const { session, tenantId } = await requireTenant();
      assertActive(session);
      if (opts.module) requireModule(session.modules, opts.module);
      const input = (opts.schema ? opts.schema.parse(raw) : (raw as I)) as I;
      const ip = await clientIp();
      const data = await opts.handler(input, {
        session,
        tenantId,
        userId: session.sub,
        ip,
      });
      return ok(data);
    } catch (e) {
      return toActionResult(e);
    }
  };
}

/** Wrapper de Server Action do SUPER_ADMIN. */
export function withAdminAction<I, O>(opts: {
  schema?: ZodType<I>;
  handler: (input: I, ctx: AdminCtx) => Promise<O>;
}) {
  return async (raw?: unknown): Promise<ActionResult<O>> => {
    try {
      const session = await requireSuperAdmin();
      assertPasswordReady(session);
      const input = (opts.schema ? opts.schema.parse(raw) : (raw as I)) as I;
      const ip = await clientIp();
      const data = await opts.handler(input, { session, userId: session.sub, ip });
      return ok(data);
    } catch (e) {
      return toActionResult(e);
    }
  };
}
