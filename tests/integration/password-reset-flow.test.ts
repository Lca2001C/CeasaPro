import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/refresh";
import {
  consumeResetToken,
  findResettableUserByEmail,
  findUserByResetToken,
  issueResetToken,
} from "@/lib/auth/password-reset";
import { hashResetToken } from "@/lib/auth/reset-token";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

// Fluxo "esqueci minha senha" contra o banco de verdade: é aqui que se verifica
// que o token é de uso único, expira, e que trocar a senha derruba as sessões.

const SENHA_ANTIGA = "senha-antiga-1";
const SENHA_NOVA = "senha-nova-2026";

let tenantId = "";
let userId = "";
let email = "";

async function resetUsuario() {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(SENHA_ANTIGA),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      active: true,
      mustChangePassword: true,
    },
  });
}

/** Sessão aberta, para provar que a troca de senha a revoga. */
async function abrirSessao() {
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(`sessao-${Date.now()}-${Math.random()}`),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

function sessoesAtivas() {
  return prisma.refreshToken.count({ where: { userId, revokedAt: null } });
}

beforeAll(async () => {
  tenantId = await createTestTenant("Reset de Senha");
  email = `dono.reset.${Date.now()}@ceasapro.com.br`;
  const user = await prisma.user.create({
    data: {
      tenantId,
      name: "Dono Reset",
      email,
      passwordHash: await hashPassword(SENHA_ANTIGA),
      role: "OWNER",
      mustChangePassword: true,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await cleanupTenants([tenantId]);
});

beforeEach(resetUsuario);

describe("Fluxo de redefinição de senha", () => {
  it("só encontra conta ativa e não excluída", async () => {
    expect(await findResettableUserByEmail(email)).toMatchObject({ id: userId, email });
    expect(await findResettableUserByEmail("nao-existe@ceasapro.com.br")).toBeNull();

    await prisma.user.update({ where: { id: userId }, data: { active: false } });
    expect(await findResettableUserByEmail(email)).toBeNull();

    await prisma.user.update({
      where: { id: userId },
      data: { active: true, deletedAt: new Date() },
    });
    expect(await findResettableUserByEmail(email)).toBeNull();
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: null } });
  });

  it("grava só o hash do token — o token cru nunca vai para o banco", async () => {
    const { raw } = await issueResetToken(userId);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    expect(row.resetTokenHash).toBe(hashResetToken(raw));
    expect(row.resetTokenHash).not.toBe(raw);
    expect(row.resetTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    // Quem tem o dump do banco não consegue redefinir: não dá para voltar do hash.
    expect(await findUserByResetToken(row.resetTokenHash!)).toBeNull();
  });

  it("pedir um link novo invalida o anterior", async () => {
    const primeiro = await issueResetToken(userId);
    const segundo = await issueResetToken(userId);

    expect(await findUserByResetToken(primeiro.raw)).toBeNull();
    expect(await findUserByResetToken(segundo.raw)).toMatchObject({ id: userId });
  });

  it("rejeita token expirado", async () => {
    const { raw } = await issueResetToken(userId);
    await prisma.user.update({
      where: { id: userId },
      data: { resetTokenExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await findUserByResetToken(raw)).toBeNull();
    const aplicou = await consumeResetToken({
      userId,
      rawToken: raw,
      passwordHash: await hashPassword(SENHA_NOVA),
    });
    expect(aplicou).toBe(false);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(row.passwordHash, SENHA_ANTIGA)).toBe(true);
  });

  it("redefine a senha, queima o token e derruba as sessões abertas", async () => {
    await abrirSessao();
    await abrirSessao();
    expect(await sessoesAtivas()).toBe(2);

    const { raw } = await issueResetToken(userId);
    const aplicou = await consumeResetToken({
      userId,
      rawToken: raw,
      passwordHash: await hashPassword(SENHA_NOVA),
    });
    expect(aplicou).toBe(true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(row.passwordHash, SENHA_NOVA)).toBe(true);
    expect(await verifyPassword(row.passwordHash, SENHA_ANTIGA)).toBe(false);
    expect(row.resetTokenHash).toBeNull();
    expect(row.resetTokenExpiresAt).toBeNull();
    // Entrou pelo link do e-mail: não faz sentido exigir troca de senha de novo.
    expect(row.mustChangePassword).toBe(false);
    expect(await sessoesAtivas()).toBe(0);
  });

  it("o link é de uso único — o segundo clique não redefine nada", async () => {
    const { raw } = await issueResetToken(userId);
    expect(
      await consumeResetToken({
        userId,
        rawToken: raw,
        passwordHash: await hashPassword(SENHA_NOVA),
      }),
    ).toBe(true);

    expect(await findUserByResetToken(raw)).toBeNull();
    expect(
      await consumeResetToken({
        userId,
        rawToken: raw,
        passwordHash: await hashPassword("outra-senha-9"),
      }),
    ).toBe(false);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(row.passwordHash, SENHA_NOVA)).toBe(true);
  });

  describe("vale como confirmação de e-mail", () => {
    let planoId = "";
    const extras: string[] = [];

    beforeAll(async () => {
      const plano = await prisma.plan.create({
        data: { name: "Plano Reset", slug: `reset-${Date.now()}`, priceMonthly: 49, active: true },
      });
      planoId = plano.id;
    });
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { tenantId: { in: extras } } });
      await cleanupTenants(extras);
      await prisma.plan.deleteMany({ where: { id: planoId } });
    });

    async function contaSemPagamento(emailVerifiedAt: Date | null) {
      const t = await createTestTenant("Reset Trial");
      extras.push(t);
      await prisma.tenantSubscription.create({
        data: {
          tenantId: t,
          planId: planoId,
          status: "SUSPENSO",
          monthlyAmount: 49,
          currentPeriodEnd: new Date(),
          graceDays: 5,
        },
      });
      const u = await prisma.user.create({
        data: {
          tenantId: t,
          name: "Dono",
          email: `reset-trial-${Date.now()}-${Math.random().toString(36).slice(2)}@teste.com`,
          passwordHash: await hashPassword(SENHA_ANTIGA),
          role: "OWNER",
          emailVerifiedAt,
        },
      });
      return { t, u };
    }

    it("cadastro público que nunca confirmou: confirma o e-mail e libera o teste", async () => {
      const { t, u } = await contaSemPagamento(null);
      const { raw } = await issueResetToken(u.id);
      expect(
        await consumeResetToken({ userId: u.id, rawToken: raw, passwordHash: await hashPassword(SENHA_NOVA) }),
      ).toBe(true);

      const depois = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(depois.emailVerifiedAt).not.toBeNull();
      const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: t } });
      expect(sub.status).toBe("TRIAL");
      expect(sub.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("conta já confirmada (cadastrada pelo admin) não ganha teste grátis", async () => {
      const { t, u } = await contaSemPagamento(new Date());
      const { raw } = await issueResetToken(u.id);
      await consumeResetToken({ userId: u.id, rawToken: raw, passwordHash: await hashPassword(SENHA_NOVA) });

      const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: t } });
      expect(sub.status).toBe("SUSPENSO");
      expect(sub.trialEndsAt).toBeNull();
    });
  });

  it("token de formato inválido não vira consulta ao banco nem redefine senha", async () => {
    await issueResetToken(userId);
    expect(await findUserByResetToken("../../etc/passwd")).toBeNull();
    expect(await findUserByResetToken("")).toBeNull();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.resetTokenHash).not.toBeNull(); // o token legítimo continua de pé
  });
});

describe("regra 5: senha, revogação e auditoria num commit só", () => {
  it("a redefinição sobe o epoch, revoga por PASSWORD e audita — tudo junto", async () => {
    await abrirSessao();
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { raw } = await issueResetToken(userId);

    expect(
      await consumeResetToken({
        userId,
        rawToken: raw,
        passwordHash: await hashPassword(SENHA_NOVA),
        ip: "10.0.0.1",
      }),
    ).toBe(true);

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // O epoch derruba os ACCESS tokens já emitidos, não só os refresh.
    expect(depois.sessionEpoch).toBe(antes.sessionEpoch + 1);
    const revogadas = await prisma.refreshToken.findMany({ where: { userId } });
    expect(revogadas.every((t) => t.revokedReason === "PASSWORD")).toBe(true);

    const registro = await prisma.auditLog.findFirst({
      where: { userId, action: "PASSWORD_RESET" },
      orderBy: { createdAt: "desc" },
    });
    expect(registro).toMatchObject({ entity: "User", entityId: userId, ip: "10.0.0.1" });
  });

  it("se QUALQUER escrita da transação falha, nada fica: senha, token e sessões intactos", async () => {
    /*
      O defeito era a revogação rodar DEPOIS do commit da senha: um soluço do
      banco entre as duas deixava a senha nova gravada e os refresh tokens
      antigos vivos. Aqui a última escrita (a auditoria) falha de verdade no
      Postgres — texto com byte nulo é recusado — e a transação inteira volta.
    */
    await abrirSessao();
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { raw } = await issueResetToken(userId);

    await expect(
      consumeResetToken({
        userId,
        rawToken: raw,
        passwordHash: await hashPassword(SENHA_NOVA),
        ip: "1.2.3.4\u0000",
      }),
    ).rejects.toThrow();

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(depois.passwordHash, SENHA_ANTIGA)).toBe(true);
    expect(depois.sessionEpoch).toBe(antes.sessionEpoch);
    expect(await sessoesAtivas()).toBe(1);
    // O link continua valendo: a pessoa pode tentar de novo.
    expect(await findUserByResetToken(raw)).toMatchObject({ id: userId });
  });
});
