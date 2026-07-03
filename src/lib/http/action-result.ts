import { ZodError } from "zod";
import { AppError } from "./app-error";
import { logger } from "@/lib/logger";

/** Resposta uniforme de Server Actions. O cliente checa sempre `res.ok`. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: string; message: string; fields?: Record<string, string> };
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: string,
  message: string,
  fields?: Record<string, string>,
): ActionResult<never> {
  return { ok: false, error: { code, message, fields } };
}

/** Converte qualquer erro em ActionResult, logando os críticos sem dados sensíveis. */
export function toActionResult(e: unknown): ActionResult<never> {
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    return fail("VALIDATION", "Verifique os campos destacados.", fields);
  }

  if (e instanceof AppError) {
    if (e.status >= 500) {
      logger.error({ code: e.code, status: e.status }, e.message);
    }
    return fail(e.code, e.message, e.fields);
  }

  const errorId = Math.random().toString(36).slice(2, 10);
  logger.error(
    { errorId, err: e instanceof Error ? e.message : String(e) },
    "Erro inesperado",
  );
  return fail(
    "INTERNAL",
    `Ocorreu um erro inesperado. Tente novamente. (ref: ${errorId})`,
  );
}
