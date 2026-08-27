import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AdminService } from "@/lib/services/admin.service";
import { verifyPassword } from "@/lib/auth/password";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
// `tenants` já é declarado abaixo; o helper de criação vem do factory.
import type { AdminCtx } from "@/lib/http/with-action";

const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
const usuarios: string[] = [];
const planos: string[] = [];
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
  await prisma.tenantSubscription.deleteMany({ where: { planId: { in: planos } } });
  await prisma.plan.deleteMany({ where: { id: { in: planos } } });
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

describe("Exclusão de usuário", () => {
  it("some da lista, derruba sessões e preserva a auditoria", async () => {
    const u = await criarUsuario({});
    await prisma.refreshToken.create({
      data: {
        userId: u.id,
        tokenHash: `hash-${uniq()}`,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    await AdminService.deleteUser(u.id, ctx);

    expect((await AdminService.listUsers()).some((x) => x.id === u.id)).toBe(false);
    expect(
      await prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } }),
    ).toBe(0);
    // Soft delete: o `userId` aparece na auditoria, e apagar a linha deixaria
    // o histórico apontando para o nada.
    const linha = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(linha.deletedAt).toBeTruthy();
    expect(linha.active).toBe(false);
  });

  it("RECUSA excluir o único responsável de uma empresa ativa", async () => {
    const tenantId = await createTestTenant("UNICO DONO");
    tenants.push(tenantId);
    const dono = await criarUsuario({ tenantId, role: "OWNER" });

    // Sem OWNER, ninguém entra naquela empresa — a exclusão viraria um
    // bloqueio acidental do cliente.
    await expect(AdminService.deleteUser(dono.id, ctx)).rejects.toThrow(/único acesso/i);
  });

  it("permite excluir um OWNER quando há outro ativo na empresa", async () => {
    const tenantId = await createTestTenant("DOIS DONOS");
    tenants.push(tenantId);
    const a = await criarUsuario({ tenantId, role: "OWNER" });
    await criarUsuario({ tenantId, role: "OWNER" });

    await AdminService.deleteUser(a.id, ctx);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).deletedAt,
    ).toBeTruthy();
  });

  it("permite excluir o OWNER de empresa já excluída", async () => {
    const tenantId = await createTestTenant("EMPRESA FORA");
    tenants.push(tenantId);
    const dono = await criarUsuario({ tenantId, role: "OWNER" });
    await prisma.tenant.update({ where: { id: tenantId }, data: { deletedAt: new Date() } });

    await AdminService.deleteUser(dono.id, ctx);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: dono.id } })).deletedAt,
    ).toBeTruthy();
  });

  it("RECUSA o super-admin excluir a própria conta", async () => {
    await expect(AdminService.deleteUser(adminId, ctx)).rejects.toThrow(/própria conta/i);
  });

  it("libera o e-mail para um cadastro novo", async () => {
    // `users.email` é UNIQUE global e o índice não sabe o que é `deletedAt`.
    // Sem liberar, recadastrar a mesma pessoa estourava violação de índice
    // único, que chegava à tela como "erro inesperado (ref: ...)".
    const email = `reaproveitado-${uniq()}@teste.com`;
    const u = await prisma.user.create({
      data: { name: "Primeiro", email, passwordHash: "x", role: "OWNER" },
    });
    usuarios.push(u.id);

    await AdminService.deleteUser(u.id, ctx);

    const novo = await prisma.user.create({
      data: { name: "Segundo", email, passwordHash: "x", role: "OWNER" },
    });
    usuarios.push(novo.id);
    expect(novo.email).toBe(email);

    // O e-mail original continua legível na linha excluída (e na auditoria).
    const antigo = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(antigo.email).toContain(email);
    expect(antigo.email).not.toBe(email);
  });
});

describe("Recadastro de empresa com o mesmo e-mail do dono", () => {
  it("excluir a empresa libera o e-mail dos usuários dela", async () => {
    const tenantId = await createTestTenant("PARA EXCLUIR");
    tenants.push(tenantId);
    const email = `dono-recriado-${uniq()}@teste.com`;
    const dono = await prisma.user.create({
      data: { tenantId, name: "Dono", email, passwordHash: "x", role: "OWNER" },
    });
    usuarios.push(dono.id);

    await AdminService.deleteTenant(tenantId, ctx);

    // O usuário some junto com a empresa e o endereço fica livre.
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: dono.id } });
    expect(depois.deletedAt).toBeTruthy();
    expect(depois.active).toBe(false);
    expect(depois.email).not.toBe(email);

    const recriado = await prisma.user.create({
      data: { name: "Dono de novo", email, passwordHash: "x", role: "OWNER" },
    });
    usuarios.push(recriado.id);
    expect(recriado.email).toBe(email);
  });

  it("createTenantWithOwner aceita e-mail de conta excluída", async () => {
    const email = `owner-${uniq()}@teste.com`;
    const orfao = await prisma.user.create({
      data: {
        name: "Antigo",
        email,
        passwordHash: "x",
        role: "OWNER",
        deletedAt: new Date(), // resíduo anterior à correção
      },
    });
    usuarios.push(orfao.id);

    const plano = await prisma.plan.create({
      data: { name: `Plano ${uniq()}`, slug: `p-${uniq()}`, priceMonthly: 10, active: true },
    });
    planos.push(plano.id);

    const { tenantId } = await AdminService.createTenantWithOwner(
      {
        tradeName: "Empresa Nova",
        ownerName: "Novo Dono",
        ownerEmail: email,
        planId: plano.id,
        monthlyAmount: 10,
        graceDays: 5,
      },
      ctx,
    );
    tenants.push(tenantId);

    const criado = await prisma.user.findFirstOrThrow({
      where: { tenantId, deletedAt: null },
    });
    expect(criado.email).toBe(email);
    usuarios.push(criado.id);
  });

  it("continua recusando e-mail de conta ATIVA", async () => {
    const ativo = await criarUsuario({});
    const plano = await prisma.plan.create({
      data: { name: `Plano ${uniq()}`, slug: `p-${uniq()}`, priceMonthly: 10, active: true },
    });
    planos.push(plano.id);

    await expect(
      AdminService.createTenantWithOwner(
        {
          tradeName: "Empresa Conflito",
          ownerName: "Alguem",
          ownerEmail: ativo.email,
          planId: plano.id,
          monthlyAmount: 10,
          graceDays: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/já existe/i);
  });
});
