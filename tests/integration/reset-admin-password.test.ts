import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createRefreshToken, rotateRefreshToken } from "@/lib/auth/refresh";
import { redefinirSenhaDoSuperAdmin } from "../../scripts/reset-admin-password";

/**
 * `scripts/reset-admin-password.ts` trocava o hash e mais nada.
 *
 * O motivo mais provável para rodá-lo é a credencial ter vazado, e o invasor já
 * logado continuava em `/admin`: o refresh seguia rotacionando e o access
 * antigo valia na escrita, porque `sessionEpoch` não mudava.
 */
const usuarios: string[] = [];

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
});

describe("reset-admin-password", () => {
  it("troca a senha e derruba as sessões abertas (refresh + epoch)", async () => {
    const email = `reset-admin-${Math.random().toString(36).slice(2, 8)}@ceasapro.com.br`;
    const admin = await prisma.user.create({
      data: { name: "Super Admin", email, passwordHash: "antigo", role: "SUPER_ADMIN" },
    });
    usuarios.push(admin.id);
    const sessao = await createRefreshToken(admin.id);

    const n = await redefinirSenhaDoSuperAdmin(prisma, email, "novo-hash");
    expect(n).toBe(1);

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(depois.passwordHash).toBe("novo-hash");
    expect(depois.mustChangePassword).toBe(true);
    expect(depois.sessionEpoch).toBe(admin.sessionEpoch + 1);
    expect(await prisma.refreshToken.count({ where: { userId: admin.id, revokedAt: null } })).toBe(0);
    expect((await rotateRefreshToken(sessao)).tipo).toBe("invalido");
  });

  it("não toca em quem não é super-admin de plataforma", async () => {
    const n = await redefinirSenhaDoSuperAdmin(prisma, `ninguem-${Date.now()}@x.com`, "h");
    expect(n).toBe(0);
  });
});
