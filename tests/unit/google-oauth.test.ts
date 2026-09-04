import { describe, expect, it, beforeAll } from "vitest";
import {
  assinarEstadoOAuth,
  googleOAuthConfig,
  lerEstadoOAuth,
  loginComErroGoogle,
  MENSAGENS_ERRO_GOOGLE,
  novoPkce,
  trocarCodigoPorPerfil,
  urlDeAutorizacaoGoogle,
  GOOGLE_AUTHORIZE,
  GOOGLE_TOKEN,
  GOOGLE_USERINFO,
} from "@/lib/auth/google-oauth";

describe("google-oauth", () => {
  beforeAll(() => {
    process.env.JWT_SECRET ??= "ci-access-secret-change-in-production-32-bytes";
  });

  it("PKCE gera verifier, challenge e state distintos", () => {
    const a = novoPkce();
    const b = novoPkce();
    expect(a.verifier).not.toBe(a.challenge);
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).toHaveLength(43);
  });

  it("o estado assinado volta igual e rejeita lixo", async () => {
    const pkce = novoPkce();
    const token = await assinarEstadoOAuth({
      state: pkce.state,
      verifier: pkce.verifier,
      next: "/estoque",
    });
    const lido = await lerEstadoOAuth(token);
    expect(lido).toEqual({
      state: pkce.state,
      verifier: pkce.verifier,
      next: "/estoque",
    });
    expect(await lerEstadoOAuth("nao-e-jwt")).toBeNull();
    expect(await lerEstadoOAuth(undefined)).toBeNull();
  });

  it("descarta next externo (open redirect)", async () => {
    const pkce = novoPkce();
    const token = await assinarEstadoOAuth({
      state: pkce.state,
      verifier: pkce.verifier,
      next: "https://evil.example/steal",
    });
    const lido = await lerEstadoOAuth(token);
    expect(lido?.next).toBeNull();
  });

  it("a URL de autorização aponta para o Google com PKCE", () => {
    const pkce = novoPkce();
    const url = urlDeAutorizacaoGoogle(
      { clientId: "id.apps.googleusercontent.com", clientSecret: "segredo" },
      pkce,
    );
    expect(url.startsWith(GOOGLE_AUTHORIZE)).toBe(true);
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain(pkce.state);
    expect(url).toContain("openid");
  });

  it("trocarCodigoPorPerfil lê userinfo e recusa e-mail não verificado", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === GOOGLE_TOKEN) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      if (url === GOOGLE_USERINFO) {
        return new Response(
          JSON.stringify({
            sub: "sub-1",
            email: "pessoa@gmail.com",
            email_verified: false,
            name: "Pessoa",
          }),
          { status: 200 },
        );
      }
      return new Response("no", { status: 404 });
    };
    const perfil = await trocarCodigoPorPerfil(
      { clientId: "id", clientSecret: "sec" },
      "code",
      "verifier",
      fetchImpl,
    );
    expect(perfil).toBeNull();
    expect(calls).toEqual([GOOGLE_TOKEN, GOOGLE_USERINFO]);
  });

  it("trocarCodigoPorPerfil devolve o perfil quando o e-mail veio verificado", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === GOOGLE_TOKEN) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          sub: "sub-99",
          email: "  Dono@Gmail.com ",
          email_verified: true,
          name: "Dono Demo",
        }),
        { status: 200 },
      );
    };
    const perfil = await trocarCodigoPorPerfil(
      { clientId: "id", clientSecret: "sec" },
      "code",
      "verifier",
      fetchImpl,
    );
    expect(perfil).toEqual({
      sub: "sub-99",
      email: "dono@gmail.com",
      emailVerified: true,
      name: "Dono Demo",
    });
  });

  it("mensagens de erro são genéricas e o config some sem as duas env", () => {
    expect(loginComErroGoogle("google-falhou")).toBe("/login?erro=google-falhou");
    expect(MENSAGENS_ERRO_GOOGLE["google-falhou"].length).toBeGreaterThan(10);
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSec = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleOAuthConfig()).toBeNull();
    process.env.GOOGLE_CLIENT_ID = prevId;
    process.env.GOOGLE_CLIENT_SECRET = prevSec;
  });
});
