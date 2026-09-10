import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A rota de login — a porta mais atacada do sistema, e ela estava em 0%.
 *
 * A lógica por baixo é bem coberta: Argon2 (`password.ts`), JWT
 * (`jwt-claims.test.ts`), rotação de refresh (`refresh-reuso.test.ts`) e o
 * contador no Postgres (`rate-limit-db.test.ts`). O que ninguém executava é a
 * FIAÇÃO — e é aí que mora o defeito clássico de "o serviço protege, mas a
 * rota esqueceu de chamar".
 *
 * `rotas-envelope.test.ts` classifica esta rota como exceção legítima ao
 * envelope (é pré-sessão por definição), o que significa que a proteção dela é
 * toda artesanal. Sem estes casos, era artesanal e não verificada.
 */

const rateLimitDb = vi.fn();
const resetRateLimit = vi.fn();
const verifyPassword = vi.fn();
const hashDeIsca = vi.fn();
const buildAccessPayload = vi.fn();
const setAuthCookies = vi.fn();
const createRefreshToken = vi.fn();
const findFirst = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findFirst: (a: unknown) => findFirst(a), update: (a: unknown) => update(a) } },
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: (h: string, p: string) => verifyPassword(h, p),
  hashDeIsca: () => hashDeIsca(),
}));
vi.mock("@/lib/auth/jwt", () => ({ signAccess: vi.fn().mockResolvedValue("access-tok") }));
vi.mock("@/lib/auth/build-session", () => ({
  buildAccessPayload: (id: string) => buildAccessPayload(id),
}));
vi.mock("@/lib/auth/cookies", () => ({
  setAuthCookies: (a: string, r: string) => setAuthCookies(a, r),
}));
vi.mock("@/lib/auth/refresh", () => ({
  createRefreshToken: (id: string, m: unknown) => createRefreshToken(id, m),
}));
vi.mock("@/lib/security/rate-limit-db", async () => {
  const real = await vi.importActual<typeof import("@/lib/security/rate-limit-db")>(
    "@/lib/security/rate-limit-db",
  );
  return {
    ...real,
    rateLimitDb: (k: string, o: unknown) => rateLimitDb(k, o),
    resetRateLimit: (k: string) => resetRateLimit(k),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/http/request", () => ({
  clientIp: vi.fn().mockResolvedValue("1.2.3.4"),
  userAgent: vi.fn().mockResolvedValue("navegador-de-teste"),
}));

const { POST } = await import("@/app/api/auth/login/route");

const USUARIO = {
  id: "user-1",
  email: "dono@box.com",
  passwordHash: "$argon2id$hash-de-verdade",
  tenantId: "empresa-A",
  role: "OWNER",
  mustChangePassword: false,
};

const entrar = (corpo: unknown = { email: "dono@box.com", password: "senha-certa" }) =>
  POST(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify(corpo) }));

beforeEach(() => {
  rateLimitDb.mockResolvedValue({ ok: true });
  resetRateLimit.mockResolvedValue(undefined);
  verifyPassword.mockResolvedValue(true);
  hashDeIsca.mockResolvedValue("$argon2id$isca");
  buildAccessPayload.mockResolvedValue({ sub: "user-1", role: "OWNER" });
  createRefreshToken.mockResolvedValue("refresh-tok");
  findFirst.mockResolvedValue(USUARIO);
  update.mockResolvedValue(USUARIO);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("não revela se o e-mail existe", () => {
  it("e-mail inexistente e senha errada devolvem EXATAMENTE a mesma resposta", async () => {
    /*
      A regra que impede enumerar contas. Qualquer diferença — status, código,
      texto — transforma o login num oráculo: dá para descobrir quem é cliente
      do CeasaPro varrendo uma lista de e-mails, e daí parte phishing dirigido.
    */
    findFirst.mockResolvedValue(null);
    const semUsuario = await entrar();
    const corpoSemUsuario = await semUsuario.json();

    findFirst.mockResolvedValue(USUARIO);
    verifyPassword.mockResolvedValue(false);
    const senhaErrada = await entrar();
    const corpoSenhaErrada = await senhaErrada.json();

    expect(semUsuario.status).toBe(senhaErrada.status);
    expect(semUsuario.status).toBe(401);
    expect(corpoSemUsuario).toEqual(corpoSenhaErrada);
    expect(corpoSemUsuario.error.message).toBe("E-mail ou senha incorretos.");
  });

  it("verifica um hash MESMO sem usuário — é o tempo que vazaria", async () => {
    /*
      Mensagem igual não basta: sem o hash de isca, a resposta para e-mail
      inexistente volta em microssegundos e a de senha errada leva o tempo do
      Argon2 (dezenas de milissegundos, de propósito). A diferença é medível
      por qualquer script, e entrega a mesma informação que a mensagem esconde.
    */
    findFirst.mockResolvedValue(null);

    await entrar();

    expect(hashDeIsca).toHaveBeenCalledTimes(1);
    expect(verifyPassword).toHaveBeenCalledWith("$argon2id$isca", "senha-certa");
  });

  it("usuário desativado ou excluído é tratado como inexistente", async () => {
    // O filtro `active: true, deletedAt: null` está na consulta; aqui se fixa
    // que ele existe, porque sem ele quem foi desligado continuaria entrando.
    await entrar();
    const where = findFirst.mock.calls[0]![0].where;
    expect(where.active).toBe(true);
    expect(where.deletedAt).toBeNull();
  });
});

describe("os dois limites de tentativa", () => {
  it("consulta IP+e-mail E e-mail sozinho", async () => {
    /*
      Dois limites de propósito: o de IP+e-mail contém a força bruta comum; o
      de e-mail sozinho é a rede para quando a identificação de origem falha
      (proxy mal configurado, cadeia de headers inesperada) e o ataque vem
      distribuído.
    */
    await entrar();

    const chaves = rateLimitDb.mock.calls.map((c) => c[0]);
    expect(chaves).toContain("login:1.2.3.4:dono@box.com");
    expect(chaves).toContain("login:email:dono@box.com");
  });

  it("o limite por e-mail é mais FOLGADO que o por IP", async () => {
    // Se fossem iguais, trancar a conta de outra pessoa custaria as mesmas
    // poucas tentativas — negação de serviço barata contra um concorrente.
    await entrar();
    const porChave = Object.fromEntries(
      rateLimitDb.mock.calls.map((c) => [c[0] as string, (c[1] as { limit: number }).limit]),
    );
    expect(porChave["login:email:dono@box.com"]).toBeGreaterThan(
      porChave["login:1.2.3.4:dono@box.com"]!,
    );
  });

  it("estourando o limite, devolve 429 e NÃO consulta o banco", async () => {
    rateLimitDb.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });

    const r = await entrar();

    expect(r.status).toBe(429);
    expect(findFirst).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("basta UM dos dois estourar", async () => {
    rateLimitDb
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 1000 });
    expect((await entrar()).status).toBe(429);
  });
});

describe("o limite é liberado no acerto, e só nele", () => {
  it("login correto zera as duas janelas", async () => {
    /*
      O limite existe para conter adivinhação de SENHA. Se o acerto também
      consumisse a janela, a mesma pessoa entrando do celular e do computador
      trancaria a própria conta — e o suporte receberia "não consigo entrar"
      de quem digitou tudo certo.
    */
    await entrar();

    const zeradas = resetRateLimit.mock.calls.map((c) => c[0]);
    expect(zeradas).toContain("login:1.2.3.4:dono@box.com");
    expect(zeradas).toContain("login:email:dono@box.com");
  });

  it("senha errada NÃO zera — senão o limite não limitaria nada", async () => {
    verifyPassword.mockResolvedValue(false);
    await entrar();
    expect(resetRateLimit).not.toHaveBeenCalled();
  });
});

describe("o que acontece quando dá certo", () => {
  it("grava os cookies de sessão", async () => {
    const r = await entrar();
    expect(r.status).toBe(200);
    expect(setAuthCookies).toHaveBeenCalledWith("access-tok", "refresh-tok");
  });

  it("o refresh token guarda IP e navegador, para a linhagem", async () => {
    // É o que permite a auditoria de reuso mostrar de onde partiu cada uso.
    await entrar();
    expect(createRefreshToken).toHaveBeenCalledWith("user-1", {
      ip: "1.2.3.4",
      userAgent: "navegador-de-teste",
    });
  });

  it("cada papel vai para a sua casa", async () => {
    expect((await (await entrar()).json()).data.redirectTo).toBe("/dashboard");

    findFirst.mockResolvedValue({ ...USUARIO, role: "SUPER_ADMIN" });
    expect((await (await entrar()).json()).data.redirectTo).toBe("/admin");
  });

  it("avisa quando a senha é provisória", async () => {
    // O OWNER criado pelo admin nasce assim; o cliente precisa ser levado à
    // troca em vez de cair no painel com senha que o suporte conhece.
    findFirst.mockResolvedValue({ ...USUARIO, mustChangePassword: true });
    expect((await (await entrar()).json()).data.mustChangePassword).toBe(true);
  });
});

describe("entrada malformada", () => {
  it("corpo inválido é 422, e não 500", async () => {
    const r = await entrar({ email: "nao-e-email", password: "" });
    expect(r.status).toBe(422);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("corpo que não é JSON também é 422", async () => {
    const r = await POST(
      new Request("http://localhost/api/auth/login", { method: "POST", body: "{ truncado" }),
    );
    expect(r.status).toBe(422);
  });

  it("sessão que não pôde ser montada cai na mensagem genérica", async () => {
    // `buildAccessPayload` devolve null quando a empresa sumiu ou o usuário
    // ficou inconsistente. Virar 500 aqui entregaria que o e-mail existe.
    buildAccessPayload.mockResolvedValue(null);

    const r = await entrar();

    expect(r.status).toBe(401);
    expect((await r.json()).error.message).toBe("E-mail ou senha incorretos.");
    expect(setAuthCookies).not.toHaveBeenCalled();
  });
});
