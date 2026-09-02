import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { purgeDeadRefreshTokens } from "@/lib/auth/refresh";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Limpeza das sessões mortas.
 *
 * Nada limpava a tabela de refresh tokens: cada login e cada renovação deixam
 * uma linha, e a renovação passou a acontecer enquanto o app está aberto (para
 * que ninguém mais perca um formulário com 401). Sem esta poda o crescimento
 * seria contínuo.
 *
 * A regra que importa é o que se GUARDA: um token revogado recentemente é
 * evidência — se ele reaparecer, é sinal de cópia roubada. Por isso a poda não
 * apaga revogado recente.
 */

const uniq = () => randomBytes(8).toString("hex");
const tenants: string[] = [];
let userId = "";

const diasAtras = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const diasAFrente = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function sessao(dados: { expiresAt: Date; revokedAt?: Date | null }) {
  return prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: uniq(),
      expiresAt: dados.expiresAt,
      revokedAt: dados.revokedAt ?? null,
    },
  });
}

const existe = async (id: string) =>
  (await prisma.refreshToken.count({ where: { id } })) === 1;

beforeAll(async () => {
  const t = await createTestTenant("SESSOES");
  tenants.push(t);
  const u = await prisma.user.create({
    data: {
      tenantId: t,
      name: "Dono Sessoes",
      email: `sessoes-${uniq()}@teste.com`,
      passwordHash: "x",
      role: "OWNER",
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await cleanupTenants(tenants);
});

beforeEach(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
});

describe("purgeDeadRefreshTokens", () => {
  it("apaga sessão vencida", async () => {
    const morta = await sessao({ expiresAt: diasAtras(1) });

    const removidas = await purgeDeadRefreshTokens();

    expect(removidas).toBeGreaterThanOrEqual(1);
    expect(await existe(morta.id)).toBe(false);
  });

  it("apaga sessão revogada há mais de uma semana", async () => {
    const antiga = await sessao({ expiresAt: diasAFrente(20), revokedAt: diasAtras(8) });

    await purgeDeadRefreshTokens();

    expect(await existe(antiga.id)).toBe(false);
  });

  it("NÃO apaga sessão revogada há pouco — é a evidência de reuso", async () => {
    // Se um token já rotacionado reaparecer, a linha revogada é o que permite
    // reconhecer que se trata de uma cópia roubada. Apagá-la na hora da rotação
    // jogaria essa informação fora.
    const recente = await sessao({ expiresAt: diasAFrente(20), revokedAt: diasAtras(1) });

    await purgeDeadRefreshTokens();

    expect(await existe(recente.id)).toBe(true);
  });

  it("NÃO apaga sessão viva", async () => {
    const viva = await sessao({ expiresAt: diasAFrente(20) });

    await purgeDeadRefreshTokens();

    // O contrário seria derrubar quem está usando o sistema no meio do dia.
    expect(await existe(viva.id)).toBe(true);
  });

  it("é idempotente: rodar de novo não remove nada a mais", async () => {
    await sessao({ expiresAt: diasAtras(1) });
    await sessao({ expiresAt: diasAFrente(20) });

    await purgeDeadRefreshTokens();
    const segunda = await purgeDeadRefreshTokens();

    expect(segunda).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(1);
  });

  it("aceita um 'agora' explícito, para o cron ser testável", async () => {
    const futura = await sessao({ expiresAt: diasAFrente(3) });

    // Ainda viva hoje; vencida do ponto de vista de dez dias à frente.
    expect(await purgeDeadRefreshTokens()).toBe(0);
    await purgeDeadRefreshTokens(diasAFrente(10));

    expect(await existe(futura.id)).toBe(false);
  });
});
