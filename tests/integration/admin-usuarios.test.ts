import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AdminService } from "@/lib/services/admin.service";
import { verifyPassword } from "@/lib/auth/password";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import type { AdminCtx } from "@/lib/http/with-action";

const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
const usuarios: string[] = [];
let ctx: AdminCtx;
let adminId = "";

async function criarUsuario(opts: {
  tenantId?: string | null;
  role?: "OWNER" | "SUPER_ADMIN";
  active?: boolean;
  nome?: string;
}) {
  const u = await prisma.user.create({
    data: {
      tenantId: opts.tenantId ?? null,
      name: opts.nome ?? `Usuario ${uniq()}`,
      email: `u-${uniq()}@teste.com`,
      passwordHash: "hash-antigo",
      role: opts.role ?? "OWNER",
      active: opts.active ?? true,
    },
  });
  usuarios.push(u.id);
  return u;
}

beforeAll(async () => {
  const admin = await criarUsuario({ role: "SUPER_ADMIN", nome: "Super Admin" });
  adminId = admin.id;
  ctx = {
    userId: admin.id,
    ip: null,
    session: {
      sub: admin.id,
      role: "SUPER_ADMIN",
      tenantId: null,
      email: admin.email,
      name: admin.name,
      mustChangePassword: false,
      tenantStatus: null,
      subStatus: null,
    },
  };
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await cleanupTenants(tenants);
});

describe("Listagem de usuários", () => {
  it("traz a empresa de cada um e inclui os administradores", async () => {
    const tenantId = await createTestTenant("USUARIOS");
    tenants.push(tenantId);
    const dono = await criarUsuario({ tenantId, nome: "Dono da Empresa" });

    const lista = await AdminService.listUsers();
    const encontrado = lista.find((u) => u.id === dono.id);
    expect(encontrado?.tenant?.tradeName).toBe("USUARIOS");
    // Quem administra a plataforma tem o acesso mais poderoso — omitir seria
    // esconder justamente o que mais importa auditar.
    expect(lista.some((u) => u.id === adminId)).toBe(true);
  });

  it("busca por nome e por e-mail", async () => {
    const alvo = await criarUsuario({ nome: `Zezinho ${uniq()}` });
    const porNome = await AdminService.listUsers({ busca: "Zezinho" });
    expect(porNome.some((u) => u.id === alvo.id)).toBe(true);

    const porEmail = await AdminService.listUsers({ busca: alvo.email.slice(0, 8) });
    expect(porEmail.some((u) => u.id === alvo.id)).toBe(true);
  });

  it("filtra somente os sem acesso", async () => {
    const inativo = await criarUsuario({ active: false });
    const ativo = await criarUsuario({ active: true });
    const lista = await AdminService.listUsers({ somenteInativos: true });
    expect(lista.some((u) => u.id === inativo.id)).toBe(true);
    expect(lista.some((u) => u.id === ativo.id)).toBe(false);
  });

  it("não lista usuário excluído", async () => {
    const u = await criarUsuario({});
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
    const lista = await AdminService.listUsers();
    expect(lista.some((x) => x.id === u.id)).toBe(false);
  });
});

describe("Ligar/desligar acesso", () => {
  it("desativar revoga as sessões abertas", async () => {
    const u = await criarUsuario({});
    await prisma.refreshToken.create({
      data: {
        userId: u.id,
        tokenHash: `hash-${uniq()}`,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    await AdminService.setUserActive({ userId: u.id, active: false }, ctx);

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(depois.active).toBe(false);
    // Sem revogar, o usuário seguiria usando o sistema até o refresh expirar —
    // o oposto do que "desativar" promete.
    const vivos = await prisma.refreshToken.count({
      where: { userId: u.id, revokedAt: null },
    });
    expect(vivos).toBe(0);
  });

  it("reativar devolve o acesso", async () => {
    const u = await criarUsuario({ active: false });
    await AdminService.setUserActive({ userId: u.id, active: true }, ctx);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).active).toBe(true);
  });

  it("RECUSA o super-admin desativar a própria conta", async () => {
    await expect(
      AdminService.setUserActive({ userId: adminId, active: false }, ctx),
    ).rejects.toThrow(/própria conta/i);
  });

  it("é idempotente: desativar duas vezes não quebra", async () => {
    const u = await criarUsuario({ active: false });
    const r = await AdminService.setUserActive({ userId: u.id, active: false }, ctx);
    expect(r.active).toBe(false);
  });
});

describe("Reset de senha pelo super-admin", () => {
  it("gera senha temporária válida e obriga a troca", async () => {
    const u = await criarUsuario({});
    const r = await AdminService.resetUserPassword(u.id, ctx);

    expect(r.tempPassword.length).toBeGreaterThan(6);
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(depois.mustChangePassword).toBe(true);
    // A senha entregue precisa realmente funcionar.
    expect(await verifyPassword(depois.passwordHash, r.tempPassword)).toBe(true);
  });

  it("derruba as sessões e invalida link de recuperação pendente", async () => {
    const u = await criarUsuario({});
    await prisma.user.update({
      where: { id: u.id },
      data: { resetTokenHash: "token-pendente", resetTokenExpiresAt: new Date(Date.now() + 1e6) },
    });
    await prisma.refreshToken.create({
      data: {
        userId: u.id,
        tokenHash: `hash-${uniq()}`,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    await AdminService.resetUserPassword(u.id, ctx);

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    // Se o motivo do reset foi conta comprometida, deixar o link antigo válido
    // devolveria o acesso a quem invadiu.
    expect(depois.resetTokenHash).toBeNull();
    expect(
      await prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } }),
    ).toBe(0);
  });

  it("recusa usuário inexistente", async () => {
    await expect(AdminService.resetUserPassword("nao-existe", ctx)).rejects.toThrow(
      /não encontrado/i,
    );
  });
});
