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

  it("token de formato inválido não vira consulta ao banco nem redefine senha", async () => {
    await issueResetToken(userId);
    expect(await findUserByResetToken("../../etc/passwd")).toBeNull();
    expect(await findUserByResetToken("")).toBeNull();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.resetTokenHash).not.toBeNull(); // o token legítimo continua de pé
  });
});
