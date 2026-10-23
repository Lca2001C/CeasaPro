import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { desserializar, serializar } from "@/lib/cache/codec";
import { clienteEmMemoria, definirClienteDeCache, type ClienteDeCache } from "@/lib/cache/cliente";
import { chaveDeModulos, invalidar, invalidarTenant, lembrar, versao } from "@/lib/cache/cache";
import { rateLimitCompartilhado } from "@/lib/security/rate-limit";
import { rateLimitDb, consultarLimiteDb, resetRateLimit } from "@/lib/security/rate-limit-db";
import { sessaoAindaValidaParaLeitura } from "@/lib/auth/revogacao";
import type { Session } from "@/lib/auth/session";

/**
 * O cache do Upstash, com o fake em memória no lugar do Redis.
 *
 * O que não pode quebrar: dinheiro volta como `Decimal`; Redis fora nunca
 * derruba a leitura; escrita da empresa troca a chave; a chave de uma empresa
 * nunca é lida por outra; revogação de sessão vale na hora.
 */

afterEach(() => {
  definirClienteDeCache(undefined);
  vi.restoreAllMocks();
});

describe("codec", () => {
  it("devolve Decimal, Date e bigint com o tipo original, inclusive aninhados", () => {
    const original = {
      total: new Prisma.Decimal("1234.56"),
      quando: new Date("2026-10-23T12:00:00.000Z"),
      n: BigInt(42),
      linhas: [{ preco: new Prisma.Decimal("0.10"), nulo: null }],
      texto: "R$",
    };
    const volta = desserializar<typeof original>(serializar(original));
    expect(Prisma.Decimal.isDecimal(volta.total)).toBe(true);
    expect(volta.total.toString()).toBe("1234.56");
    expect(volta.quando).toBeInstanceOf(Date);
    expect(volta.quando.getTime()).toBe(original.quando.getTime());
    expect(volta.n).toBe(BigInt(42));
    expect(Prisma.Decimal.isDecimal(volta.linhas[0]!.preco)).toBe(true);
    expect(volta.linhas[0]!.preco.plus(1).toString()).toBe("1.1");
    expect(volta.linhas[0]!.nulo).toBeNull();
    expect(volta.texto).toBe("R$");
  });

  it("guarda null e undefined sem confundir com falta", () => {
    expect(desserializar(serializar(null))).toBeNull();
    expect(desserializar(serializar(undefined))).toBeUndefined();
  });
});

describe("lembrar", () => {
  it("sem Redis é só a função, sempre", async () => {
    definirClienteDeCache(null);
    const fn = vi.fn().mockResolvedValue(1);
    await lembrar({ chave: "x", ttlSeg: 60 }, fn);
    await lembrar({ chave: "x", ttlSeg: 60 }, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("guarda na primeira leitura e serve a segunda do cache", async () => {
    definirClienteDeCache(clienteEmMemoria());
    const fn = vi.fn(async () => ({ v: new Prisma.Decimal("9.90") }));
    const a = await lembrar({ chave: "y", versoes: [versao.tenant("t1")], ttlSeg: 60 }, fn);
    const b = await lembrar({ chave: "y", versoes: [versao.tenant("t1")], ttlSeg: 60 }, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(b.v.toString()).toBe(a.v.toString());
  });

  it("a escrita da empresa troca a versão e a leitura seguinte recalcula", async () => {
    definirClienteDeCache(clienteEmMemoria());
    let valor = 1;
    const ler = () => lembrar({ chave: "dash:t1", versoes: [versao.tenant("t1")], ttlSeg: 60 }, async () => valor);
    expect(await ler()).toBe(1);
    valor = 2;
    expect(await ler()).toBe(1);
    await invalidarTenant("t1");
    expect(await ler()).toBe(2);
  });

  it("a versão de uma empresa não esfria a outra, e a chave de uma nunca serve a outra", async () => {
    definirClienteDeCache(clienteEmMemoria());
    const fnA = vi.fn().mockResolvedValue("A");
    const fnB = vi.fn().mockResolvedValue("B");
    const lerA = () => lembrar({ chave: "dash:tA", versoes: [versao.tenant("tA")], ttlSeg: 60 }, fnA);
    const lerB = () => lembrar({ chave: "dash:tB", versoes: [versao.tenant("tB")], ttlSeg: 60 }, fnB);
    expect(await lerA()).toBe("A");
    expect(await lerB()).toBe("B");
    await invalidarTenant("tA");
    await lerA();
    await lerB();
    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("Redis com erro cai no banco (fail-open) e não lança", async () => {
    const quebrado: ClienteDeCache = {
      ...clienteEmMemoria(),
      lerVersionado: () => Promise.reject(new Error("upstash fora")),
    };
    definirClienteDeCache(quebrado);
    expect(await lembrar({ chave: "z", ttlSeg: 60 }, async () => "do banco")).toBe("do banco");
    await expect(invalidarTenant("t1")).resolves.toBeUndefined();
  });

  it("Redis lento não segura a tela: passa do teto e lê do banco", async () => {
    const lento: ClienteDeCache = {
      ...clienteEmMemoria(),
      lerVersionado: () => new Promise(() => {}),
    };
    definirClienteDeCache(lento);
    const inicio = Date.now();
    expect(await lembrar({ chave: "z", ttlSeg: 60 }, async () => "do banco")).toBe("do banco");
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  it("falha na gravação devolve o valor calculado do mesmo jeito", async () => {
    const semGravar: ClienteDeCache = { ...clienteEmMemoria(), set: () => Promise.reject(new Error("cheio")) };
    definirClienteDeCache(semGravar);
    expect(await lembrar({ chave: "w", ttlSeg: 60 }, async () => 7)).toBe(7);
  });

  it("chaveDeModulos não depende da ordem", () => {
    expect(chaveDeModulos(["b", "a"])).toBe(chaveDeModulos(["a", "b"]));
    expect(chaveDeModulos(undefined)).toBe("-");
  });
});

describe("rate limit no Redis", () => {
  const OPTS = { limit: 3, windowMs: 60_000 };

  beforeEach(() => definirClienteDeCache(clienteEmMemoria()));

  it("conta no Redis e não vai ao Postgres", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw");
    const chave = "login:9.9.9.9:a@b.com";
    for (let i = 0; i < 3; i++) expect((await rateLimitDb(chave, OPTS)).ok).toBe(true);
    const estourou = await rateLimitDb(chave, OPTS);
    expect(estourou.ok).toBe(false);
    expect(estourou.retryAfterMs).toBeGreaterThan(0);
    expect((await consultarLimiteDb(chave, OPTS)).ok).toBe(false);
    await resetRateLimit(chave);
    expect((await consultarLimiteDb(chave, OPTS)).ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("Redis fora cai no Postgres, que continua fail-closed", async () => {
    definirClienteDeCache({
      ...clienteEmMemoria(),
      consumirJanela: () => Promise.reject(new Error("upstash fora")),
    });
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("pool esgotado"));
    const r = await rateLimitDb("login:9.9.9.9:a@b.com", OPTS);
    expect(r.ok).toBe(false);
    expect(r.indisponivel).toBe(true);
  });

  it("o throttle por empresa é um só para todas as instâncias", async () => {
    for (let i = 0; i < 3; i++) expect((await rateLimitCompartilhado("route:t1", OPTS)).ok).toBe(true);
    expect((await rateLimitCompartilhado("route:t1", OPTS)).ok).toBe(false);
    expect((await rateLimitCompartilhado("route:t2", OPTS)).ok).toBe(true);
  });
});

describe("sessão nos layouts", () => {
  const session = { sub: "u1", tenantId: "t1", fid: "f1", sev: 0, tev: 0 } as Session;
  const estado = (ue: number) => [{ ue, ativo: true, excluido: null, te: 0, familiaEncerrada: false }];

  it("lê o banco uma vez e serve as navegações seguintes do cache", async () => {
    definirClienteDeCache(clienteEmMemoria());
    const spy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue(estado(0) as never);
    expect(await sessaoAindaValidaParaLeitura(session)).toBe(true);
    expect(await sessaoAindaValidaParaLeitura(session)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("revogação do usuário vale na hora, mesmo com a chave quente", async () => {
    definirClienteDeCache(clienteEmMemoria());
    const spy = vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(estado(0) as never);
    expect(await sessaoAindaValidaParaLeitura(session)).toBe(true);
    spy.mockResolvedValueOnce(estado(1) as never);
    await invalidar(versao.sessaoUsuario("u1"));
    expect(await sessaoAindaValidaParaLeitura(session)).toBe(false);
  });

  it("logout de um aparelho não esfria o outro", async () => {
    definirClienteDeCache(clienteEmMemoria());
    const outro = { ...session, fid: "f2" } as Session;
    const spy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue(estado(0) as never);
    await sessaoAindaValidaParaLeitura(session);
    await sessaoAindaValidaParaLeitura(outro);
    await invalidar(versao.sessaoFamilia("f1"));
    await sessaoAindaValidaParaLeitura(session);
    await sessaoAindaValidaParaLeitura(outro);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
