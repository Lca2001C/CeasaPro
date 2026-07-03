import pino from "pino";

/**
 * Logger central com redaction — nunca loga senha, tokens, cookies ou dados de pagamento.
 * Configuração sem transports (compatível com serverless/Next).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: [
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
