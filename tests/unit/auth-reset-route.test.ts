import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `POST /api/auth/reset` — a fiação da rota.
 *
 * A regra do token (uso único, expiração, revogação) é coberta contra o banco
 * em `password-reset-flow.test.ts`. Aqui ficam duas coisas que só a rota decide:
 * falha inesperada sai no envelope padrão (não um 500 cru que o formulário não
 * sabe ler), e o IP chega a `consumeResetToken`, que agora grava a auditoria
 * dentro da mesma transação da senha.
 */

const rateLimitDb = vi.fn();
const hashPassword = vi.fn();
const findUserByResetToken = vi.fn();
const consumeResetToken = vi.fn();
const sendEmail = vi.fn();
const audit = vi.fn();

vi.mock("@/lib/security/rate-limit-db", async () => {
  const real = await vi.importActual<typeof import("@/lib/security/rate-limit-db")>(
    "@/lib/security/rate-limit-db",
  );
  return { ...real, rateLimitDb: (k: string, o: unknown) => rateLimitDb(k, o) };
});
vi.mock("@/lib/auth/password", () => ({ hashPassword: (p: string) => hashPassword(p) }));
vi.mock("@/lib/auth/password-reset", () => ({
  findUserByResetToken: (t: string) => findUserByResetToken(t),
  consumeResetToken: (a: unknown) => consumeResetToken(a),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  passwordChangedEmail: () => ({ subject: "s", html: "h" }),
}));
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));
vi.mock("@/lib/http/request", () => ({ clientIp: vi.fn().mockResolvedValue("1.2.3.4") }));
vi.mock("next/server", async () => {
  const real = await vi.importActual<typeof import("next/server")>("next/server");
  // `after` fora de uma requisição do Next lança; aqui só não roda.
  return { ...real, after: vi.fn() };
});

const { POST } = await import("@/app/api/auth/reset/route");

const TOKEN = "t".repeat(43);
const redefinir = (corpo: unknown = { token: TOKEN, password: "senha-nova-forte-1", confirm: "senha-nova-forte-1" }) =>
  POST(new Request("http://localhost/api/auth/reset", { method: "POST", body: JSON.stringify(corpo) }));

beforeEach(() => {
  rateLimitDb.mockResolvedValue({ ok: true });
  hashPassword.mockResolvedValue("$argon2id$nova");
  findUserByResetToken.mockResolvedValue({ id: "user-1", email: "dono@box.com", name: "Dono", tenantId: "t" });
  consumeResetToken.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("falha inesperada", () => {
  it("banco fora na transação vira o envelope 500 INTERNAL", async () => {
    consumeResetToken.mockRejectedValue(new Error("connection terminated"));

    const r = await redefinir();

    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(JSON.stringify(corpo)).not.toContain("connection terminated");
  });

  it("rate limit sem conexão também", async () => {
    rateLimitDb.mockRejectedValue(new Error("pool esgotado"));
    const r = await redefinir();
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe("INTERNAL");
  });
});

describe("a auditoria vai para dentro da transação", () => {
  it("o IP chega a consumeResetToken, e a rota não audita por fora", async () => {
    /*
      Auditar aqui, depois do commit, era a metade da regra 5 que faltava: a
      senha trocada podia ficar sem o registro de quem a trocou.
    */
    const r = await redefinir();

    expect(r.status).toBe(200);
    expect(consumeResetToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", rawToken: TOKEN, ip: "1.2.3.4" }),
    );
    expect(audit).not.toHaveBeenCalled();
  });

  it("link já usado continua 400 INVALID_TOKEN", async () => {
    consumeResetToken.mockResolvedValue(false);
    const r = await redefinir();
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("INVALID_TOKEN");
  });
});
