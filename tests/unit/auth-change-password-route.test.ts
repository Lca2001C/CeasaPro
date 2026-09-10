import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A troca de senha — a rota que existe para EXPULSAR quem não devia estar lá.
 *
 * Trocar a senha é o que a pessoa faz quando desconfia que alguém entrou na
 * conta dela. Se a rota não derrubar as outras sessões, ela troca a senha,
 * respira aliviada, e o invasor continua dentro com o token que já tinha — por
 * até 15 minutos no access, e para sempre no refresh.
 *
 * Estava em 0%. O E2E evita `/alterar-senha` de propósito (ver
 * `admin-painel.spec.ts`), então não havia cobertura de nenhum tipo.
 */

const getSession = vi.fn();
const rateLimitDb = vi.fn();
const verifyPassword = vi.fn();
const hashPassword = vi.fn();
const revokeAllForUser = vi.fn();
const createRefreshToken = vi.fn();
const buildAccessPayload = vi.fn();
const setAuthCookies = vi.fn();
const findFirst = vi.fn();
const update = vi.fn();
/** Ordem real das operações sensíveis, para afirmar a sequência. */
const ordem: string[] = [];

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findFirst: (a: unknown) => findFirst(a),
      update: (a: unknown) => {
        ordem.push("update-senha");
        return update(a);
      },
    },
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: () => getSession() }));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: (h: string, p: string) => verifyPassword(h, p),
  hashPassword: (p: string) => hashPassword(p),
}));
vi.mock("@/lib/auth/jwt", () => ({ signAccess: vi.fn().mockResolvedValue("novo-access") }));
vi.mock("@/lib/auth/build-session", () => ({
  buildAccessPayload: (id: string) => buildAccessPayload(id),
}));
vi.mock("@/lib/auth/cookies", () => ({
  setAuthCookies: (a: string, r: string) => setAuthCookies(a, r),
}));
vi.mock("@/lib/auth/refresh", () => ({
  revokeAllForUser: (id: string, m: string) => {
    ordem.push("revogar");
    return revokeAllForUser(id, m);
  },
  createRefreshToken: (id: string, m: unknown) => {
    ordem.push("criar-refresh");
    return createRefreshToken(id, m);
  },
}));
vi.mock("@/lib/security/rate-limit-db", async () => {
  const real = await vi.importActual<typeof import("@/lib/security/rate-limit-db")>(
    "@/lib/security/rate-limit-db",
  );
  return { ...real, rateLimitDb: (k: string, o: unknown) => rateLimitDb(k, o) };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/http/request", () => ({
  clientIp: vi.fn().mockResolvedValue("1.2.3.4"),
  userAgent: vi.fn().mockResolvedValue("navegador"),
}));

const { POST } = await import("@/app/api/auth/change-password/route");

const USUARIO = {
  id: "user-1",
  email: "dono@box.com",
  passwordHash: "$argon2id$antiga",
  tenantId: "empresa-A",
  role: "OWNER",
};
const SENHA_NOVA = "senha-nova-forte-123";

const trocar = (corpo: unknown = { currentPassword: "senha-atual", newPassword: SENHA_NOVA }) =>
  POST(
    new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(corpo),
    }),
  );

beforeEach(() => {
  ordem.length = 0;
  getSession.mockResolvedValue({ sub: "user-1", role: "OWNER", tenantId: "empresa-A" });
  rateLimitDb.mockResolvedValue({ ok: true });
  verifyPassword.mockResolvedValue(true);
  hashPassword.mockResolvedValue("$argon2id$nova");
  revokeAllForUser.mockResolvedValue(undefined);
  createRefreshToken.mockResolvedValue("novo-refresh");
  buildAccessPayload.mockResolvedValue({ sub: "user-1" });
  findFirst.mockResolvedValue(USUARIO);
  update.mockResolvedValue(USUARIO);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("expulsar as outras sessões", () => {
  it("revoga TUDO do usuário ao trocar a senha", async () => {
    /*
      A razão de a rota existir. Sem esta chamada, quem trocou a senha porque
      desconfiou de invasão continua com o invasor dentro — o access dele vale
      mais 15 minutos, e o refresh vale até expirar.
    */
    await trocar();
    expect(revokeAllForUser).toHaveBeenCalledWith("user-1", "PASSWORD");
  });

  it("revoga ANTES de criar o novo refresh — a ordem é o que mantém a pessoa logada", async () => {
    /*
      Se a revogação viesse depois, ela derrubaria também o token recém-criado:
      a pessoa trocaria a senha e seria deslogada no mesmo instante, sem
      entender por quê. É o tipo de defeito que só aparece na ordem das linhas.
    */
    await trocar();

    const iRevogar = ordem.indexOf("revogar");
    const iCriar = ordem.indexOf("criar-refresh");
    expect(iRevogar).toBeGreaterThanOrEqual(0);
    expect(iCriar).toBeGreaterThan(iRevogar);
  });

  it("grava cookies novos, então a sessão atual sobrevive", async () => {
    await trocar();
    expect(setAuthCookies).toHaveBeenCalledWith("novo-access", "novo-refresh");
  });
});

describe("o que a troca limpa junto", () => {
  it("apaga o token de recuperação pendente", async () => {
    /*
      Quem pediu "esqueci minha senha" e depois lembrou dela tem um link válido
      circulando no e-mail. Trocar a senha sem invalidá-lo deixaria esse link
      funcionando — e e-mail é o canal mais fácil de comprometer.
    */
    await trocar();
    const dados = update.mock.calls[0]![0].data;
    expect(dados.resetTokenHash).toBeNull();
    expect(dados.resetTokenExpiresAt).toBeNull();
  });

  it("desliga a exigência de senha provisória", async () => {
    await trocar();
    expect(update.mock.calls[0]![0].data.mustChangePassword).toBe(false);
  });

  it("grava o HASH, nunca a senha", async () => {
    await trocar();
    const dados = update.mock.calls[0]![0].data;
    expect(dados.passwordHash).toBe("$argon2id$nova");
    expect(JSON.stringify(dados)).not.toContain(SENHA_NOVA);
  });
});

describe("quem não passa", () => {
  it("sem sessão é 401, e nada é tocado", async () => {
    getSession.mockResolvedValue(null);
    const r = await trocar();
    expect(r.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it("senha atual errada é 400 e NÃO troca nada", async () => {
    /*
      Sem conferir a senha atual, um token roubado bastaria para tomar a conta
      de vez: o invasor trocaria a senha e expulsaria o dono, invertendo os
      papéis.
    */
    verifyPassword.mockResolvedValue(false);

    const r = await trocar();

    expect(r.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(revokeAllForUser).not.toHaveBeenCalled();
    expect(setAuthCookies).not.toHaveBeenCalled();
  });

  it("tem limite de tentativa, com a chave amarrada ao usuário", async () => {
    // Sem limite, um token roubado permitiria adivinhar a senha atual à
    // vontade — e a senha atual é a única barreira entre o invasor e a posse
    // definitiva da conta.
    rateLimitDb.mockResolvedValue({ ok: false, retryAfterMs: 1000 });

    const r = await trocar();

    expect(r.status).toBe(429);
    expect(rateLimitDb.mock.calls[0]![0]).toContain("user-1");
    expect(update).not.toHaveBeenCalled();
  });

  it("usuário desativado no meio do caminho não troca", async () => {
    findFirst.mockResolvedValue(null);
    const r = await trocar();
    expect(r.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("senha nova fraca é recusada pelo schema", async () => {
    const r = await trocar({ currentPassword: "senha-atual", newPassword: "123" });
    expect(r.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it("corpo que não é JSON é 422, e não 500", async () => {
    const r = await POST(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        body: "{ truncado",
      }),
    );
    expect(r.status).toBe(422);
  });
});
