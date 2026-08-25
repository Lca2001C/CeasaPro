import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { rateLimitDb, purgeExpiredRateLimits, resetRateLimit } from "@/lib/security/rate-limit-db";

// Rate limit das rotas de auth contra o Postgres de verdade. É aqui que se
// verifica o que o contador em memória não dava: contagem correta sob
// concorrência e sobrevivência à troca de instância.

const PREFIXO = `teste-rl-${Date.now()}`;
const JANELA = { limit: 3, windowMs: 60_000 };

function chave(sufixo: string) {
  return `${PREFIXO}:${sufixo}`;
}

function hashDe(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/** Remove só as linhas criadas por este arquivo. */
async function limpar() {
  const rows = await prisma.rateLimit.findMany({ select: { keyHash: true } });
  const meus = rows
    .map((r) => r.keyHash)
    .filter((h) =>
      ["a", "b", "concorrente", "expira", "pii"].some((s) => hashDe(chave(s)) === h),
    );
  if (meus.length > 0) {
    await prisma.rateLimit.deleteMany({ where: { keyHash: { in: meus } } });
  }
}

beforeEach(limpar);
afterAll(limpar);

describe("Rate limit persistido no banco", () => {
  it("libera até o limite e bloqueia depois", async () => {
    const k = chave("a");
    for (let i = 1; i <= JANELA.limit; i++) {
      const r = await rateLimitDb(k, JANELA);
      expect(r.ok, `tentativa ${i} deveria passar`).toBe(true);
    }

    const bloqueada = await rateLimitDb(k, JANELA);
    expect(bloqueada.ok).toBe(false);
    expect(bloqueada.retryAfterMs).toBeGreaterThan(0);
    expect(bloqueada.retryAfterMs).toBeLessThanOrEqual(JANELA.windowMs);
  });

  it("chaves diferentes não compartilham contador", async () => {
    const a = chave("a");
    const b = chave("b");
    for (let i = 0; i < JANELA.limit + 1; i++) await rateLimitDb(a, JANELA);

    expect((await rateLimitDb(a, JANELA)).ok).toBe(false);
    expect((await rateLimitDb(b, JANELA)).ok).toBe(true);
  });

  it("não perde contagem com requisições concorrentes", async () => {
    const k = chave("concorrente");
    // 10 tentativas simultâneas, limite 3: exatamente 3 podem passar.
    // Com SELECT-depois-UPDATE, várias leriam o mesmo valor e passariam juntas.
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => rateLimitDb(k, JANELA)),
    );

    expect(resultados.filter((r) => r.ok)).toHaveLength(JANELA.limit);
    const row = await prisma.rateLimit.findUniqueOrThrow({ where: { keyHash: hashDe(k) } });
    expect(row.count).toBe(10);
  });

  it("zera quando a janela vence, sem precisar de limpeza", async () => {
    const k = chave("expira");
    for (let i = 0; i < JANELA.limit + 1; i++) await rateLimitDb(k, JANELA);
    expect((await rateLimitDb(k, JANELA)).ok).toBe(false);

    // Empurra a expiração para o passado — equivale a esperar a janela acabar.
    await prisma.rateLimit.update({
      where: { keyHash: hashDe(k) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const depois = await rateLimitDb(k, JANELA);
    expect(depois.ok).toBe(true);
    const row = await prisma.rateLimit.findUniqueOrThrow({ where: { keyHash: hashDe(k) } });
    expect(row.count).toBe(1); // recomeçou a janela
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("guarda só o hash — IP e e-mail não vão para a tabela", async () => {
    const k = chave("pii");
    await rateLimitDb(k, JANELA);

    const row = await prisma.rateLimit.findUniqueOrThrow({ where: { keyHash: hashDe(k) } });
    expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.keyHash).not.toContain(PREFIXO);
    expect(await prisma.rateLimit.findUnique({ where: { keyHash: k } })).toBeNull();
  });

  it("resetRateLimit devolve a janela inteira (usado quando a senha confere)", async () => {
    const k = chave("a");
    for (let i = 0; i < JANELA.limit + 1; i++) await rateLimitDb(k, JANELA);
    expect((await rateLimitDb(k, JANELA)).ok).toBe(false);

    await resetRateLimit(k);

    expect(await prisma.rateLimit.findUnique({ where: { keyHash: hashDe(k) } })).toBeNull();
    // E o orçamento volta cheio, não só uma tentativa.
    for (let i = 1; i <= JANELA.limit; i++) {
      expect((await rateLimitDb(k, JANELA)).ok, `tentativa ${i}`).toBe(true);
    }
    expect((await rateLimitDb(k, JANELA)).ok).toBe(false);
  });

  it("resetRateLimit em chave inexistente não quebra", async () => {
    await expect(resetRateLimit(chave("nunca-usada"))).resolves.toBeUndefined();
  });

  it("resetRateLimit não afeta as outras chaves", async () => {
    const a = chave("a");
    const b = chave("b");
    await rateLimitDb(a, JANELA);
    await rateLimitDb(b, JANELA);

    await resetRateLimit(a);

    expect(await prisma.rateLimit.findUnique({ where: { keyHash: hashDe(a) } })).toBeNull();
    expect(await prisma.rateLimit.findUnique({ where: { keyHash: hashDe(b) } })).not.toBeNull();
  });

  it("a limpeza remove as janelas vencidas e preserva as ativas", async () => {
    const ativa = chave("a");
    const vencida = chave("expira");
    await rateLimitDb(ativa, JANELA);
    await rateLimitDb(vencida, JANELA);
    await prisma.rateLimit.update({
      where: { keyHash: hashDe(vencida) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const removidas = await purgeExpiredRateLimits();

    expect(removidas).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimit.findUnique({ where: { keyHash: hashDe(vencida) } })).toBeNull();
    expect(await prisma.rateLimit.findUnique({ where: { keyHash: hashDe(ativa) } })).not.toBeNull();
  });
});
