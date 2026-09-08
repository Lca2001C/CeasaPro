import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AdminService } from "@/lib/services/admin.service";
import { novaEmpresaSchema } from "@/lib/validations/admin";
import { BusinessRuleError } from "@/lib/http/app-error";
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

    const { usuarios: lista } = await AdminService.listUsers();
    const encontrado = lista.find((u) => u.id === dono.id);
    expect(encontrado?.tenant?.tradeName).toBe("USUARIOS");
    // Quem administra a plataforma tem o acesso mais poderoso — omitir seria
    // esconder justamente o que mais importa auditar.
    expect(lista.some((u) => u.id === adminId)).toBe(true);
  });

  it("busca por nome e por e-mail", async () => {
    const alvo = await criarUsuario({ nome: `Zezinho ${uniq()}` });
    const { usuarios: porNome } = await AdminService.listUsers({ busca: "Zezinho" });
    expect(porNome.some((u) => u.id === alvo.id)).toBe(true);

    const { usuarios: porEmail } = await AdminService.listUsers({
      busca: alvo.email.slice(0, 8),
    });
    expect(porEmail.some((u) => u.id === alvo.id)).toBe(true);
  });

  it("filtra somente os sem acesso", async () => {
    const inativo = await criarUsuario({ active: false });
    const ativo = await criarUsuario({ active: true });
    const { usuarios: lista } = await AdminService.listUsers({ somenteInativos: true });
    expect(lista.some((u) => u.id === inativo.id)).toBe(true);
    expect(lista.some((u) => u.id === ativo.id)).toBe(false);
  });

  it("não lista usuário excluído", async () => {
    const u = await criarUsuario({});
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
    const { usuarios: lista } = await AdminService.listUsers();
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

    const { usuarios: depois } = await AdminService.listUsers();
    expect(depois.some((x) => x.id === u.id)).toBe(false);
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

  it("excluir a empresa libera o vínculo do Google do dono", async () => {
    // `googleSub` é @unique. Se a linha excluída continuasse ocupando o valor,
    // o cliente que voltasse pelo botão do Google batia em violação de índice
    // e recebia 500 — o callback não tem try/catch — sem nunca conseguir
    // recadastrar. Caso comum: "errou no cadastro, exclui e faz de novo".
    const tenantId = await createTestTenant("COM GOOGLE");
    tenants.push(tenantId);
    const dono = await prisma.user.create({
      data: {
        tenantId,
        name: "Dono Google",
        email: `dono-google-${uniq()}@teste.com`,
        passwordHash: "x",
        role: "OWNER",
        googleSub: `sub-excluido-${uniq()}`,
      },
    });
    usuarios.push(dono.id);

    await AdminService.deleteTenant(tenantId, ctx);

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: dono.id } });
    expect(depois.googleSub).toBeNull();
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

/**
 * CNPJ em branco não pode ocupar o índice único.
 *
 * `Tenant.cnpj` é `@unique` e GLOBAL: NULL repete à vontade, string vazia
 * não. O campo é opcional na tela e o formulário manda `""`, então a primeira
 * empresa salva sem CNPJ ocupava a vaga — e da segunda em diante o cadastro
 * falhava com "Ocorreu um erro inesperado", de forma determinística. O mesmo
 * defeito travava o cliente final em Configurações → Empresa.
 */
describe("CNPJ opcional e único", () => {
  let planoId = "";

  beforeAll(async () => {
    const plano = await prisma.plan.create({
      data: { name: `Plano CNPJ ${uniq()}`, slug: `p-cnpj-${uniq()}`, priceMonthly: 100, active: true },
    });
    planos.push(plano.id);
    planoId = plano.id;
  });
  it("duas empresas sem CNPJ convivem (em branco vira null, não string vazia)", async () => {
    const a = await AdminService.createTenantWithOwner(
      novaEmpresaSchema.parse({
        tradeName: "Box Sem CNPJ A",
        cnpj: "",
        ownerName: "Dono A",
        ownerEmail: `sem-cnpj-a-${uniq()}@teste.com`,
        planId: planoId,
        monthlyAmount: 100,
        graceDays: 5,
      }),
      ctx,
    );
    tenants.push(a.tenantId);

    const b = await AdminService.createTenantWithOwner(
      novaEmpresaSchema.parse({
        tradeName: "Box Sem CNPJ B",
        cnpj: "",
        ownerName: "Dono B",
        ownerEmail: `sem-cnpj-b-${uniq()}@teste.com`,
        planId: planoId,
        monthlyAmount: 100,
        graceDays: 5,
      }),
      ctx,
    );
    tenants.push(b.tenantId);

    const ambos = await prisma.tenant.findMany({
      where: { id: { in: [a.tenantId, b.tenantId] } },
      select: { cnpj: true },
    });
    expect(ambos.map((t) => t.cnpj)).toEqual([null, null]);
  });

  it("CNPJ repetido é recusado com mensagem, não com 'erro inesperado'", async () => {
    const cnpj = `12345678${uniq().slice(0, 6)}`;
    const a = await AdminService.createTenantWithOwner(
      novaEmpresaSchema.parse({
        tradeName: "Box CNPJ",
        cnpj,
        ownerName: "Dono",
        ownerEmail: `cnpj-a-${uniq()}@teste.com`,
        planId: planoId,
        monthlyAmount: 100,
        graceDays: 5,
      }),
      ctx,
    );
    tenants.push(a.tenantId);

    await expect(
      AdminService.createTenantWithOwner(
        novaEmpresaSchema.parse({
          tradeName: "Outro Box",
          cnpj,
          ownerName: "Outro",
          ownerEmail: `cnpj-b-${uniq()}@teste.com`,
          planId: planoId,
          monthlyAmount: 100,
          graceDays: 5,
        }),
        ctx,
      ),
      // P2002 também traz a palavra "cnpj": o que mudou é o TIPO do erro. Erro
      // de negócio chega na tela como mensagem; P2002 virava "Ocorreu um erro
      // inesperado. Tente novamente. (ref: …)", que convida a repetir algo que
      // nunca vai dar certo.
    ).rejects.toThrow(BusinessRuleError);
  });

  it("excluir a empresa libera o CNPJ para o recadastro", async () => {
    const cnpj = `98765432${uniq().slice(0, 6)}`;
    const a = await AdminService.createTenantWithOwner(
      novaEmpresaSchema.parse({
        tradeName: "Box a excluir",
        cnpj,
        ownerName: "Dono",
        ownerEmail: `cnpj-del-${uniq()}@teste.com`,
        planId: planoId,
        monthlyAmount: 100,
        graceDays: 5,
      }),
      ctx,
    );
    tenants.push(a.tenantId);

    await AdminService.deleteTenant(a.tenantId, ctx);

    // "Errou no cadastro, exclui e faz de novo" — o caso que a própria base
    // trata como comum — batia em violação de índice.
    const b = await AdminService.createTenantWithOwner(
      novaEmpresaSchema.parse({
        tradeName: "Box recadastrado",
        cnpj,
        ownerName: "Dono",
        ownerEmail: `cnpj-re-${uniq()}@teste.com`,
        planId: planoId,
        monthlyAmount: 100,
        graceDays: 5,
      }),
      ctx,
    );
    tenants.push(b.tenantId);
    const recriada = await prisma.tenant.findUniqueOrThrow({ where: { id: b.tenantId } });
    expect(recriada.cnpj).toBe(cnpj);
  });
});

/**
 * Os contadores não podem sair da lista truncada.
 *
 * `listUsers` corta em 200 com ordem "ativo primeiro", e a tela contava os
 * cartões sobre esse conjunto. Como os desativados ficam no fim da ordenação,
 * eram exatamente eles os cortados: passando de 200 usuários com acesso, o
 * cartão "Sem acesso" marcava 0 e o filtro respondia "nenhum usuário
 * encontrado". O super-admin concluía que não havia ninguém bloqueado.
 */
describe("Contadores da tela de usuários", () => {
  it("o desativado é contado mesmo fora dos 200 exibidos", async () => {
    const marca = `lote-${uniq()}`;
    const inativo = await criarUsuario({ nome: `${marca} sem acesso`, active: false });

    // 205 ativos com o mesmo prefixo: a lista (200) enche só de ativos, porque
    // a ordenação põe `active: true` primeiro.
    await prisma.user.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        name: `${marca} ativo ${i}`,
        email: `${marca}-${i}@teste.com`,
        passwordHash: "x",
        role: "OWNER" as const,
        active: true,
      })),
    });
    const criadosAgora = await prisma.user.findMany({
      where: { name: { startsWith: marca } },
      select: { id: true },
    });
    usuarios.push(...criadosAgora.map((u) => u.id));

    const { usuarios: lista, totais } = await AdminService.listUsers({ busca: marca });

    // A lista é truncada e avisa...
    expect(lista.length).toBe(200);
    expect(totais.truncado).toBe(true);
    expect(lista.some((u) => u.id === inativo.id)).toBe(false);

    // ...mas o total conta os 206 e enxerga o desativado.
    expect(totais.total).toBe(206);
    expect(totais.semAcesso).toBe(1);
  });

  it("busca sem resultado devolve zeros, não a contagem anterior", async () => {
    const { usuarios: lista, totais } = await AdminService.listUsers({
      busca: `nao-existe-${uniq()}`,
    });
    expect(lista).toEqual([]);
    expect(totais.total).toBe(0);
    expect(totais.semAcesso).toBe(0);
    expect(totais.truncado).toBe(false);
  });
});
