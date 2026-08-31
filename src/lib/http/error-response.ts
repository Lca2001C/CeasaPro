import { ZodError } from "zod";
import { AppError } from "./app-error";
import { describeError, logger } from "@/lib/logger";

/**
 * Erro → resposta JSON no formato que o cliente já espera
 * (`{ ok: false, error: { code, message, fields? } }`).
 *
 * Estava dentro de `with-route.ts`. Foi extraído para poder ser usado também nas
 * rotas que NÃO passam por `withRoute` porque não têm sessão de empresa — o
 * cadastro público, por exemplo. Duplicar o formato ali faria a mesma falha
 * chegar ao front com dois contratos diferentes.
 *
 * Comportamento inalterado: 422 para falha de schema, o status da própria
 * `AppError` quando é erro de negócio, e 500 com identificador rastreável para o
 * resto — nunca a mensagem interna.
 */
export function errorResponse(e: unknown): Response {
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
  logger.error({ errorId, err: describeError(e) }, "Erro em route handler");
  return Response.json(
    { ok: false, error: { code: "INTERNAL", message: `Erro inesperado (ref: ${errorId})` } },
    { status: 500 },
  );
}
