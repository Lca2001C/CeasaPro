import type { ZodType } from "zod";
import { ZodError } from "zod";
import { requireTenant, requireSuperAdmin, type Session } from "@/lib/auth/session";
import { accessDecision } from "@/lib/billing/status";
import { AppError, PaymentRequiredError } from "./app-error";
import { clientIp } from "./request";
import { logger } from "@/lib/logger";

export interface RouteTenantCtx {
  session: Session;
  tenantId: string;
  userId: string;
  ip: string | null;
  req: Request;
}

function errorResponse(e: unknown): Response {
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    return Response.json(
      { ok: false, error: { code: "VALIDATION", message: "Dados inválidos", fields } },
      { status: 422 },
    );
  }
  if (e instanceof AppError) {
    return Response.json(
      { ok: false, error: { code: e.code, message: e.message, fields: e.fields } },
      { status: e.status },
    );
  }
  const errorId = Math.random().toString(36).slice(2, 10);
  logger.error({ errorId, err: e instanceof Error ? e.message : String(e) }, "Erro em route handler");
  return Response.json(
    { ok: false, error: { code: "INTERNAL", message: `Erro inesperado (ref: ${errorId})` } },
    { status: 500 },
  );
}

async function parseInput<I>(
  req: Request,
  schema: ZodType<I> | undefined,
  source: "json" | "query",
): Promise<I> {
  if (!schema) return undefined as I;
  if (source === "query") {
    const url = new URL(req.url);
    return schema.parse(Object.fromEntries(url.searchParams.entries()));
  }
  const body = await req.json().catch(() => ({}));
  return schema.parse(body);
}

/** Wrapper de Route Handler da EMPRESA (áreas transacionais / export). */
export function withTenantRoute<I, O>(opts: {
  schema?: ZodType<I>;
  source?: "json" | "query";
  allowInactive?: boolean; // rotas de regularização (billing) continuam acessíveis quando bloqueado
  handler: (input: I, ctx: RouteTenantCtx) => Promise<O | Response>;
}) {
  return async (req: Request): Promise<Response> => {
    try {
      const { session, tenantId } = await requireTenant();
      if (
        !opts.allowInactive &&
        accessDecision(session.tenantStatus, session.subStatus) === "blocked"
      ) {
        throw new PaymentRequiredError();
      }
      const input = await parseInput(req, opts.schema, opts.source ?? "json");
      const ip = await clientIp();
      const out = await opts.handler(input, { session, tenantId, userId: session.sub, ip, req });
      if (out instanceof Response) return out; // handlers de export devolvem arquivo
      return Response.json({ ok: true, data: out });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Wrapper de Route Handler do SUPER_ADMIN. */
export function withAdminRoute<I, O>(opts: {
  schema?: ZodType<I>;
  source?: "json" | "query";
  handler: (
    input: I,
    ctx: { session: Session; userId: string; ip: string | null; req: Request },
  ) => Promise<O | Response>;
}) {
  return async (req: Request): Promise<Response> => {
    try {
      const session = await requireSuperAdmin();
      const input = await parseInput(req, opts.schema, opts.source ?? "json");
      const ip = await clientIp();
      const out = await opts.handler(input, { session, userId: session.sub, ip, req });
      if (out instanceof Response) return out;
      return Response.json({ ok: true, data: out });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
