import pino from "pino";

/**
 * Logger central com redaction — nunca loga senha, tokens, cookies ou dados de pagamento.
 * Configuração sem transports (compatível com serverless/Next).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: [
      "err.raw.token",
      "err.raw.*.token",
      "password",
      "senha",
      "passwordHash",
      "*.password",
      "*.senha",
      "*.passwordHash",
      "token",
      "tokens",
      "accessToken",
      "refreshToken",
      "authorization",
      "cookie",
      "headers.authorization",
      "headers.cookie",
      "rawPayload",
    ],
    censor: "[REDACTED]",
  },
});

/**
 * Descreve QUALQUER valor lançado — inclusive o que não é `Error`.
 *
 * Existe porque o SDK do Mercado Pago faz `throw await response.json()`: ele
 * lança um **objeto puro** (`{ message, error, status, cause: [...] }`), não uma
 * instância de `Error`. O idioma `e instanceof Error ? e.message : String(e)`,
 * que estava espalhado pelo código, transformava esse objeto em
 * `"[object Object]"` — jogando fora exatamente a causa da recusa do pagamento.
 *
 * Prisma, `fetch` e o resto do ecossistema lançam `Error` de verdade, então o
 * caminho comum continua sendo só a `message`.
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object" && e !== null) {
    try {
      return JSON.stringify(e);
    } catch {
      // Referência circular: sobra o construtor, melhor que "[object Object]".
      return `[objeto ${e.constructor?.name ?? "desconhecido"} não serializável]`;
    }
  }
  return String(e);
}
