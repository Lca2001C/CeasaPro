import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email";

/**
 * Sem SMTP em produção, nenhum e-mail sai — e `sendEmail` respondia "ok". O
 * cadastro mostrava "verifique seu e-mail" para um link que nunca chegava, sem
 * nenhum alarme. Fora de produção o no-op continua (dev e testes rodam sem SMTP).
 */
describe("sendEmail sem SMTP configurado", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("em produção, falha (ok: false) em vez de fingir que enviou", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await sendEmail("dono@exemplo.com", "Assunto", "<p>oi</p>");
    expect(res.ok).toBe(false);
  });

  it("fora de produção, continua o no-op", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const res = await sendEmail("dono@exemplo.com", "Assunto", "<p>oi</p>");
    expect(res).toEqual({ ok: true, id: "dev-noop" });
  });
});
