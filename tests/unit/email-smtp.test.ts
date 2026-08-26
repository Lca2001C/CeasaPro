import { describe, it, expect } from "vitest";
import { isRetriableSmtpError, isEmailConfigured } from "@/lib/email";

/**
 * A diferença entre 4xx e 5xx no SMTP decide se um e-mail se perde ou não:
 * 4xx é temporário (caixa cheia, limite de envio, servidor ocupado) e merece
 * nova tentativa; 5xx é definitivo (credencial errada, destinatário inexistente)
 * e repetir só queima a reputação do remetente.
 */
describe("isRetriableSmtpError", () => {
  it("repete em 4xx do SMTP", () => {
    expect(isRetriableSmtpError(undefined, "Too many messages", 421)).toBe(true);
    expect(isRetriableSmtpError(undefined, "Mailbox busy", 450)).toBe(true);
    expect(isRetriableSmtpError(undefined, "Rate exceeded", 452)).toBe(true);
  });

  it("NÃO repete em 5xx — inclusive credencial recusada", () => {
    // 535 é o que o Gmail devolve quando a senha não é uma senha de app.
    expect(isRetriableSmtpError(undefined, "Username and Password not accepted", 535)).toBe(
      false,
    );
    expect(isRetriableSmtpError(undefined, "No such user", 550)).toBe(false);
    expect(isRetriableSmtpError(undefined, "Message too large", 552)).toBe(false);
  });

  it("repete em falha de rede, que não tem código SMTP", () => {
    expect(isRetriableSmtpError("ETIMEDOUT", "connect ETIMEDOUT")).toBe(true);
    expect(isRetriableSmtpError("ECONNRESET", "socket hang up")).toBe(true);
    expect(isRetriableSmtpError("ECONNREFUSED", "connect ECONNREFUSED")).toBe(true);
    expect(isRetriableSmtpError("ESOCKET", "socket close")).toBe(true);
    expect(isRetriableSmtpError("EAI_AGAIN", "getaddrinfo EAI_AGAIN")).toBe(true);
  });

  it("cai na heurística de mensagem quando não há código nenhum", () => {
    expect(isRetriableSmtpError(undefined, "Connection timeout")).toBe(true);
    expect(isRetriableSmtpError(undefined, "please try again later")).toBe(true);
    expect(isRetriableSmtpError(undefined, "invalid recipient")).toBe(false);
  });

  it("o código SMTP tem precedência sobre a mensagem", () => {
    // Mensagem parece transitória, mas 550 é definitivo: não repete.
    expect(isRetriableSmtpError(undefined, "try again", 550)).toBe(false);
  });
});

describe("isEmailConfigured", () => {
  it("reflete a presença das credenciais do ambiente", () => {
    const esperado = Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
    expect(isEmailConfigured()).toBe(esperado);
  });
});
