import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `/api/auth/renovar` como SAÍDA de uma sessão revogada.
 *
 * O caso de produção: a senha foi trocada em outro aparelho (ou o super-admin
 * bloqueou a empresa). O `sessionEpoch` subiu, mas o access cookie deste
 * navegador ainda vive 15 minutos. O layout recusava a sessão LANÇANDO, a
 * exceção caía no `global-error` ("Tentar de novo" falha igual), e ir ao
 * `/login` não resolvia: o proxy vê o cookie vivo e manda de volta à home.
 *
 * Agora o layout redireciona para cá com `revogada=1`. O que esta rota precisa
 * garantir para não haver laço é APAGAR os cookies sempre que não houver como
 * renovar — sem o access cookie, o proxy deixa o `/login` abrir.
 */

const readRefreshCookie = vi.fn();
const setAuthCookies = vi.fn();
const clearAuthCookies = vi.fn();
const marcarTentativaDeRenovacao = vi.fn();
const renovouAgoraHaPouco = vi.fn();
const rotateRefreshToken = vi.fn();
const revokeRefreshToken = vi.fn();
const auditarReusoDeSessao = vi.fn();
const buildAccessPayload = vi.fn();

vi.mock("@/lib/auth/cookies", () => ({
  readRefreshCookie: () => readRefreshCookie(),
  setAuthCookies: (a: string, r: string) => setAuthCookies(a, r),
  clearAuthCookies: () => clearAuthCookies(),
  marcarTentativaDeRenovacao: () => marcarTentativaDeRenovacao(),
  renovouAgoraHaPouco: () => renovouAgoraHaPouco(),
}));
vi.mock("@/lib/auth/refresh", () => ({
  rotateRefreshToken: (t: string, m: unknown) => rotateRefreshToken(t, m),
  revokeRefreshToken: (t: string, m: string) => revokeRefreshToken(t, m),
  auditarReusoDeSessao: (...a: unknown[]) => auditarReusoDeSessao(...a),
}));
vi.mock("@/lib/auth/build-session", () => ({
  buildAccessPayload: (id: string) => buildAccessPayload(id),
}));
vi.mock("@/lib/auth/jwt", () => ({ signAccess: vi.fn().mockResolvedValue("access-novo") }));
vi.mock("@/lib/http/request", () => ({
  clientIp: vi.fn().mockResolvedValue("1.2.3.4"),
  userAgent: vi.fn().mockResolvedValue("navegador"),
}));

const { GET } = await import("@/app/api/auth/renovar/route");
const { rotaDeSessaoRevogada } = await import("@/lib/auth/renovacao");

const NAVEGACAO = { "sec-fetch-mode": "navigate" };

const abrir = (caminho: string, cabecalhos: Record<string, string> = NAVEGACAO) =>
  GET(new Request(`http://localhost${caminho}`, { headers: cabecalhos }));

const destino = (r: Response) => r.headers.get("location");

beforeEach(() => {
  readRefreshCookie.mockResolvedValue("refresh-atual");
  renovouAgoraHaPouco.mockResolvedValue(false);
  rotateRefreshToken.mockResolvedValue({ tipo: "invalido" });
  buildAccessPayload.mockResolvedValue({ sub: "user-1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("vindo de um layout que recusou a sessão", () => {
  const ROTA = rotaDeSessaoRevogada("/dashboard");

  it("refresh revogado junto (o caso normal): apaga os cookies e vai ao login", async () => {
    /*
      `revokeAllForUser`/`revokeAllForTenant` derrubam o refresh e sobem o
      epoch na mesma transação, então quase sempre é este o caminho. Apagar os
      cookies é o que quebra o laço /login → proxy → /dashboard → layout.
    */
    const r = await abrir(ROTA);

    expect(r.status).toBe(303);
    expect(destino(r)).toBe("/login?next=%2Fdashboard");
    expect(clearAuthCookies).toHaveBeenCalledOnce();
    expect(setAuthCookies).not.toHaveBeenCalled();
  });

  it("sem refresh cookie: apaga MESMO ASSIM — o access cookie ainda está vivo", async () => {
    /*
      Antes esta saída não apagava nada, porque o único a chegar aqui era o
      proxy, que só desvia quem já não tem access cookie. Vindo do layout, o
      access cookie está lá; sem apagá-lo, o /login devolvia para a home.
    */
    readRefreshCookie.mockResolvedValue(undefined);

    const r = await abrir(ROTA);

    expect(destino(r)).toBe("/login?next=%2Fdashboard");
    expect(clearAuthCookies).toHaveBeenCalledOnce();
    expect(rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("refresh ainda vivo: renova e devolve ao destino, com o token novo", async () => {
    rotateRefreshToken.mockResolvedValue({ tipo: "ok", userId: "user-1", newToken: "refresh-novo" });

    const r = await abrir(ROTA);

    expect(destino(r)).toBe("/dashboard");
    expect(setAuthCookies).toHaveBeenCalledWith("access-novo", "refresh-novo");
    expect(marcarTentativaDeRenovacao).toHaveBeenCalledOnce();
    expect(clearAuthCookies).not.toHaveBeenCalled();
  });

  it("segunda passada logo depois de renovar: NÃO renova de novo, encerra", async () => {
    /*
      A trava contra layout → renovar → layout em círculo. Se a sessão recém-
      -emitida também foi recusada, renovar outra vez só repetiria o salto.
    */
    renovouAgoraHaPouco.mockResolvedValue(true);

    const r = await abrir(ROTA);

    expect(destino(r)).toBe("/login?next=%2Fdashboard");
    expect(rotateRefreshToken).not.toHaveBeenCalled();
    expect(revokeRefreshToken).toHaveBeenCalledWith("refresh-atual", "LOGOUT");
    expect(clearAuthCookies).toHaveBeenCalledOnce();
  });

  it("super-admin volta para /admin", async () => {
    const r = await abrir(rotaDeSessaoRevogada("/admin"));
    expect(destino(r)).toBe("/login?next=%2Fadmin");
  });

  it("sem Fetch Metadata de navegação continua 403, sem mexer em nada", async () => {
    const r = await abrir(ROTA, { "sec-fetch-mode": "cors" });
    expect(r.status).toBe(403);
    expect(clearAuthCookies).not.toHaveBeenCalled();
    expect(rotateRefreshToken).not.toHaveBeenCalled();
  });
});

describe("o desvio do proxy não mudou", () => {
  it("com a marca de renovação mas SEM `revogada`, renova normalmente", async () => {
    /*
      A regra da segunda passada vale só para quem vem do layout. Sem essa
      restrição, o botão "Entrar no CeasaPro" de `/conta/suspensa` (que aponta
      para cá) deslogaria quem o apertasse até 30 s depois de uma renovação.
    */
    renovouAgoraHaPouco.mockResolvedValue(true);
    rotateRefreshToken.mockResolvedValue({ tipo: "ok", userId: "user-1", newToken: "refresh-novo" });

    const r = await abrir("/api/auth/renovar?next=%2Fcompras%2Fnova");

    expect(destino(r)).toBe("/compras/nova");
    expect(setAuthCookies).toHaveBeenCalledWith("access-novo", "refresh-novo");
    expect(revokeRefreshToken).not.toHaveBeenCalled();
  });

  it("refresh inválido: apaga e vai ao login com o destino", async () => {
    const r = await abrir("/api/auth/renovar?next=%2Ffiado");
    expect(destino(r)).toBe("/login?next=%2Ffiado");
    expect(clearAuthCookies).toHaveBeenCalledOnce();
  });
});
