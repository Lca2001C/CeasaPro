import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Retorno do "Entrar com Google" quando algo LANÇA no meio.
 *
 * O callback já tratava os "não" esperados (state errado, code recusado,
 * conta inativa) mandando ao login com mensagem genérica. O que não tratava
 * eram as falhas que lançam: a rede caindo na troca do code com o Google
 * (`fetch` rejeita, não devolve `!ok`) e o banco fora ao vincular a conta.
 * Aquilo virava um 500 cru numa aba que a pessoa abriu pelo botão do login.
 */

const trocarCodigoPorPerfil = vi.fn();
const lerEstadoOAuth = vi.fn();
const resolverLoginGoogle = vi.fn();
const abrirSessaoGoogle = vi.fn();
const clearGoogleOAuthCookie = vi.fn();
const loggerError = vi.fn();

vi.mock("@/lib/auth/google-oauth", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/auth/google-oauth")>("@/lib/auth/google-oauth");
  return {
    ...real,
    googleOAuthConfig: () => ({ clientId: "id", clientSecret: "segredo" }),
    lerEstadoOAuth: (c: unknown) => lerEstadoOAuth(c),
    trocarCodigoPorPerfil: (...a: unknown[]) => trocarCodigoPorPerfil(...a),
  };
});
vi.mock("@/lib/auth/cookies", () => ({
  clearGoogleOAuthCookie: () => clearGoogleOAuthCookie(),
  readGoogleOAuthCookie: vi.fn().mockResolvedValue("cookie-assinado"),
}));
vi.mock("@/lib/services/google-login.service", () => ({
  resolverLoginGoogle: (...a: unknown[]) => resolverLoginGoogle(...a),
  abrirSessaoGoogle: (...a: unknown[]) => abrirSessaoGoogle(...a),
}));
vi.mock("@/lib/http/request", () => ({
  clientIp: vi.fn().mockResolvedValue("1.2.3.4"),
  userAgent: vi.fn().mockResolvedValue("navegador"),
}));
vi.mock("@/lib/logger", async () => {
  const real = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...real, logger: { ...real.logger, error: (...a: unknown[]) => loggerError(...a) } };
});

const { NextRequest } = await import("next/server");
const { GET } = await import("@/app/api/auth/google/callback/route");

const voltar = (q = "code=abc&state=st-1") =>
  GET(new NextRequest(`http://localhost:3000/api/auth/google/callback?${q}`));

const destino = (r: Response) => {
  const l = r.headers.get("location");
  return l ? new URL(l).pathname + new URL(l).search : null;
};

beforeEach(() => {
  clearGoogleOAuthCookie.mockResolvedValue(undefined);
  lerEstadoOAuth.mockResolvedValue({ state: "st-1", verifier: "v", next: null });
  trocarCodigoPorPerfil.mockResolvedValue({ sub: "g-1", email: "dono@gmail.com", emailVerified: true });
  resolverLoginGoogle.mockResolvedValue({ ok: true, userId: "user-1", role: "OWNER" });
  abrirSessaoGoogle.mockResolvedValue({ redirectTo: "/dashboard" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("falhas que lançam viram o login com aviso", () => {
  it("rede caindo na troca do code com o Google", async () => {
    trocarCodigoPorPerfil.mockRejectedValue(new TypeError("fetch failed"));

    const r = await voltar();

    expect(r.status).toBeGreaterThanOrEqual(300);
    expect(r.status).toBeLessThan(400);
    expect(destino(r)).toBe("/login?erro=google-falhou");
    // E fica registrado: sem o log, "o Google não entra" não teria por onde começar.
    expect(loggerError).toHaveBeenCalledOnce();
  });

  it("banco fora ao vincular a conta", async () => {
    resolverLoginGoogle.mockRejectedValue(new Error("Can't reach database server"));
    const r = await voltar();
    expect(destino(r)).toBe("/login?erro=google-falhou");
    expect(abrirSessaoGoogle).not.toHaveBeenCalled();
  });

  it("banco fora ao abrir a sessão", async () => {
    abrirSessaoGoogle.mockRejectedValue(new Error("pool esgotado"));
    const r = await voltar();
    expect(destino(r)).toBe("/login?erro=google-falhou");
  });

  it("falha ANTES de apagar o cookie de state: apaga no caminho de erro", async () => {
    lerEstadoOAuth.mockRejectedValue(new Error("chave de assinatura ausente"));

    const r = await voltar();

    expect(destino(r)).toBe("/login?erro=google-falhou");
    expect(clearGoogleOAuthCookie).toHaveBeenCalled();
  });

  it("nem apagar o cookie falhando derruba a resposta", async () => {
    lerEstadoOAuth.mockRejectedValue(new Error("x"));
    clearGoogleOAuthCookie.mockRejectedValue(new Error("y"));
    const r = await voltar();
    expect(destino(r)).toBe("/login?erro=google-falhou");
  });

  it("a mensagem interna não vai para a URL", async () => {
    resolverLoginGoogle.mockRejectedValue(new Error("relation users does not exist"));
    const r = await voltar();
    expect(r.headers.get("location")).not.toContain("relation");
  });
});

describe("o caminho feliz e os 'não' esperados não mudaram", () => {
  it("login ok vai ao destino da sessão", async () => {
    expect(destino(await voltar())).toBe("/dashboard");
  });

  it("state que não confere cai no login sem trocar o code", async () => {
    const r = await voltar("code=abc&state=outro");
    expect(destino(r)).toBe("/login?erro=google-falhou");
    expect(trocarCodigoPorPerfil).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("cancelado no Google", async () => {
    expect(destino(await voltar("error=access_denied"))).toBe("/login?erro=google-cancelado");
  });
});
