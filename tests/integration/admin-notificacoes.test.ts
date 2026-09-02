import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AdminNotificationsService } from "@/lib/services/admin-notifications.service";
import { AdminService } from "@/lib/services/admin.service";
import { SignupService } from "@/lib/services/signup.service";
import { cleanupTenants } from "../helpers/factory";
import type { AdminCtx } from "@/lib/http/with-action";

/**
 * Caixa de entrada do super-admin.
 *
 * Dois grupos de coisa a provar aqui:
 *
 * 1. **O aviso nasce nos dois caminhos de cadastro** — o público e o do painel —
 *    porque a caixa só serve se for relato completo de quem entrou.
 * 2. **O aviso nunca derruba o cadastro.** O caminho público é a aquisição do
 *    produto; perder um cliente porque uma linha de aviso falhou seria trocar o
 *    essencial pelo acessório.
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const tenants: string[] = [];
const usuarios: string[] = [];
let ctx: AdminCtx;
let planId = "";

async function limparCaixa() {
  await prisma.adminNotification.deleteMany({});
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      tenantId: null,
      name: "Admin Notif",
      email: `admin-notif-${uniq()}@teste.com`,
      passwordHash: "x",
      role: "SUPER_ADMIN",
    },
  });
  usuarios.push(admin.id);
  ctx = {
    userId: admin.id,
    ip: null,
    session: {
      sub: admin.id,
      role: "SUPER_ADMIN",
      tenantId: null,
      name: admin.name,
      email: admin.email,
      mustChangePassword: false,
    },
  } as AdminCtx;

  const plan = await prisma.plan.create({
    data: {
      name: "Plano Notif",
      slug: `notif-${uniq()}`,
      priceMonthly: 49.9,
      active: true,
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await limparCaixa();
  await cleanupTenants(tenants);
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await limparCaixa();
});

describe("aviso de conta criada", () => {
  it("cadastro pelo painel gera aviso com link para a empresa", async () => {
    const email = `dono-${uniq()}@teste.com`;
    const r = await AdminService.createTenantWithOwner(
      {
        tradeName: "Hortifruti Painel",
        ownerName: "Dono Painel",
        ownerEmail: email,
        planId,
        monthlyAmount: 49.9,
        graceDays: 5,
      } as Parameters<typeof AdminService.createTenantWithOwner>[0],
      ctx,
    );
    tenants.push(r.tenantId);

    const avisos = await AdminNotificationsService.listar();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      kind: "USER_CREATED",
      href: `/admin/clientes/${r.tenantId}`,
      readAt: null,
    });
    expect(avisos[0]!.body).toContain(email);
    expect(avisos[0]!.title).toMatch(/painel/i);
  });

  it("cadastro público gera aviso que diz que o teste começa na confirmação", async () => {
    const email = `publico-${uniq()}@teste.com`;
    const res = await SignupService.register(
      {
        tradeName: "Box do Zé",
        email,
        password: "senha1234",
        phone: "31999990000",
      } as Parameters<typeof SignupService.register>[0],
      { ip: null },
    );
    expect(res.outcome).toBe("created");
    if (res.tenantId) tenants.push(res.tenantId);

    const avisos = await AdminNotificationsService.listar();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.title).toMatch(/site/i);
    expect(avisos[0]!.body).toContain("Box do Zé");
    // O trial só começa na confirmação do e-mail — o texto não pode prometer
    // que a empresa já está testando.
    expect(avisos[0]!.body).toMatch(/confirmar o e-mail/i);
  });

  it("cadastro recusado por e-mail já em uso NÃO gera aviso", async () => {
    const email = `dup-${uniq()}@teste.com`;
    const primeiro = await SignupService.register(
      {
        tradeName: "Primeiro",
        email,
        password: "senha1234",
        phone: "31999990000",
      } as Parameters<typeof SignupService.register>[0],
      { ip: null },
    );
    if (primeiro.tenantId) tenants.push(primeiro.tenantId);
    await limparCaixa();

    const segundo = await SignupService.register(
      {
        tradeName: "Segundo",
        email,
        password: "senha1234",
        phone: "31999990000",
      } as Parameters<typeof SignupService.register>[0],
      { ip: null },
    );
    expect(segundo.outcome).toBe("email_already_in_use");

    // Nada foi criado, então não há nada a avisar. Avisar aqui encheria a caixa
    // com tentativas em contas existentes — inclusive as de quem errou o e-mail.
    expect(await AdminNotificationsService.listar()).toHaveLength(0);
  });

  it("falha ao gravar o aviso NÃO derruba o cadastro público", async () => {
    vi.spyOn(prisma.adminNotification, "create").mockRejectedValue(
      new Error("banco indisponivel"),
    );

    const email = `resiliente-${uniq()}@teste.com`;
    const res = await SignupService.register(
      {
        tradeName: "Sobrevivente",
        email,
        password: "senha1234",
        phone: "31999990000",
      } as Parameters<typeof SignupService.register>[0],
      { ip: null },
    );

    // O cliente entrou, que é o que importa.
    expect(res.outcome).toBe("created");
    if (res.tenantId) {
      tenants.push(res.tenantId);
      const criado = await prisma.user.findFirst({ where: { email }, select: { id: true } });
      expect(criado).not.toBeNull();
    }
  });
});

describe("estado de lido", () => {
  async function tresAvisos() {
    for (const i of [1, 2, 3]) {
      await AdminNotificationsService.criar({
        kind: "USER_CREATED",
        title: `Aviso ${i}`,
        body: `corpo ${i}`,
      });
    }
  }

  it("conta as não lidas", async () => {
    await tresAvisos();
    expect(await AdminNotificationsService.contarNaoLidas()).toEqual({
      total: 3,
      saturado: false,
    });
  });

  it("marcar uma como lida tira ela da contagem", async () => {
    await tresAvisos();
    const [primeiro] = await AdminNotificationsService.listar();
    const r = await AdminNotificationsService.marcarComoLida(primeiro!.id);

    expect(r.marcadas).toBe(1);
    expect((await AdminNotificationsService.contarNaoLidas()).total).toBe(2);
  });

  it("marcar de novo não é erro e preserva a data do primeiro 'lido'", async () => {
    await tresAvisos();
    const [primeiro] = await AdminNotificationsService.listar();
    await AdminNotificationsService.marcarComoLida(primeiro!.id);

    const lida = await prisma.adminNotification.findUniqueOrThrow({
      where: { id: primeiro!.id },
      select: { readAt: true },
    });

    // Acontece de verdade: duas abas abertas, ou o outro admin clicando junto.
    const segundaVez = await AdminNotificationsService.marcarComoLida(primeiro!.id);
    expect(segundaVez.marcadas).toBe(0);

    const depois = await prisma.adminNotification.findUniqueOrThrow({
      where: { id: primeiro!.id },
      select: { readAt: true },
    });
    expect(depois.readAt?.getTime()).toBe(lida.readAt?.getTime());
  });

  it("id inexistente não é erro", async () => {
    const r = await AdminNotificationsService.marcarComoLida("nao-existe");
    expect(r.marcadas).toBe(0);
  });

  it("marcar todas zera a campainha", async () => {
    await tresAvisos();
    const r = await AdminNotificationsService.marcarTodasComoLidas();

    expect(r.marcadas).toBe(3);
    expect((await AdminNotificationsService.contarNaoLidas()).total).toBe(0);
    // As lidas continuam na caixa: é histórico, não fila.
    expect(await AdminNotificationsService.listar()).toHaveLength(3);
    expect(await AdminNotificationsService.listar({ apenasNaoLidas: true })).toHaveLength(0);
  });

  it("marcar todas com a caixa vazia devolve zero, sem erro", async () => {
    expect(await AdminNotificationsService.marcarTodasComoLidas()).toEqual({ marcadas: 0 });
  });

  it("lista as mais recentes primeiro", async () => {
    await tresAvisos();
    const titulos = (await AdminNotificationsService.listar()).map((n) => n.title);
    expect(titulos).toEqual(["Aviso 3", "Aviso 2", "Aviso 1"]);
  });

  it("a contagem satura em 99 em vez de crescer sem limite", async () => {
    await prisma.adminNotification.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        kind: "USER_CREATED" as const,
        title: `Volume ${i}`,
        body: "x",
      })),
    });

    const r = await AdminNotificationsService.contarNaoLidas();
    expect(r).toEqual({ total: 99, saturado: true });
  });

  it("falha ao contar não derruba o painel", async () => {
    vi.spyOn(prisma.adminNotification, "findMany").mockRejectedValue(new Error("timeout"));
    // A campainha fica no cabeçalho de TODA página do admin: uma exceção aqui
    // deixaria o painel inteiro inacessível.
    expect(await AdminNotificationsService.contarNaoLidas()).toEqual({
      total: 0,
      saturado: false,
    });
  });
});
