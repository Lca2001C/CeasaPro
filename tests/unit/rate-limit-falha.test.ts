import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { rateLimitDb, respostaDeLimite } from "@/lib/security/rate-limit-db";

/**
 * O que acontece quando o CONTADOR não pode ser consultado.
 *
 * Antes, qualquer exceção do Postgres liberava a requisição com um `warn`. E
 * todas as janelas de autenticação — login, recuperação de senha, cadastro,
 * reset, troca de senha — vivem nessa mesma função: um único incidente de banco
 * desligava as cinco ao mesmo tempo. Como `rateLimitDb` faz duas consultas por
 * tentativa de login, saturar o pool é barato, e quem conseguisse fazê-lo
 * ganhava força bruta ilimitada como efeito colateral.
 */

const OPTS = { limit: 5, windowMs: 15 * 60 * 1000 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rateLimitDb com o banco fora", () => {
  it("RECUSA a requisição em vez de liberar", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("pool esgotado"));

    const r = await rateLimitDb("login:1.2.3.4:teste@exemplo.com", OPTS);

    expect(r.ok).toBe(false);
    expect(r.indisponivel).toBe(true);
  });

  it("tenta uma segunda vez antes de desistir", async () => {
    // Esgotamento momentâneo de pool no Neon é comum e passa sozinho. Sem a
    // retentativa, o fail-closed viraria indisponibilidade por soluço.
    const spy = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValueOnce(new Error("soluço"))
      .mockResolvedValueOnce([
        { count: 1, expiresAt: new Date(Date.now() + OPTS.windowMs) },
      ] as never);

    const r = await rateLimitDb("login:1.2.3.4:teste@exemplo.com", OPTS);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    expect(r.indisponivel).toBeUndefined();
  });
});

describe("respostaDeLimite distingue os dois motivos", () => {
  it("banco fora responde 503, não 429", async () => {
    // 429 "muitas tentativas" é uma acusação: usá-la quando o problema é nosso
    // manda a pessoa esperar 15 minutos por algo que dura segundos.
    const res = respostaDeLimite({ ok: false, retryAfterMs: 1000, indisponivel: true });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    const corpo = await res.json();
    expect(corpo.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("limite realmente estourado responde 429", async () => {
    const res = respostaDeLimite({ ok: false, retryAfterMs: 60_000 });
    expect(res.status).toBe(429);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("RATE_LIMIT");
  });
});
