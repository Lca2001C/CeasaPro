import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { AdminService } from "@/lib/services/admin.service";
import { JANELA_ONLINE_MINUTOS } from "@/lib/auth/presence";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * Presença ("quem está usando agora") e situação de cobrança na lista de
 * usuários do painel.
 *
 * A presença sai da sessão viva: um refresh token não revogado, não expirado e
 * renovado dentro da janela. Os testes abaixo cobrem cada um dos três recortes,
 * porque cada um remove um falso positivo diferente — e o mais importante é o do
 * logout, que era o buraco de usar `lastLoginAt` (o logout não mexe naquela
 * coluna, então quem saiu continuaria aparecendo presente).
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const tenants: string[] = [];
const usuariosSoltos: string[] = [];
let planId = "";

const minutosAtras = (n: number) => new Date(Date.now() - n * 60 * 1000);
const dias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function criarUsuario(tenantId: string | null, nome: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      tenantId,
      name: nome,
      email: `presenca-${uniq()}@teste.com`,
      passwordHash: "x",
      role: tenantId ? "OWNER" : "SUPER_ADMIN",
    },
  });
  if (!tenantId) usuariosSoltos.push(u.id);
  return u.id;
}

/** Sessão como o login/rotação a criariam, com a idade e o estado pedidos. */
async function criarSessao(
  userId: string,
  opts: { criadaMinutosAtras?: number; revogada?: boolean; expirada?: boolean } = {},
) {
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: randomBytes(24).toString("hex"),
      createdAt: minutosAtras(opts.criadaMinutosAtras ?? 0),
      expiresAt: opts.expirada ? minutosAtras(1) : dias(30),
      revokedAt: opts.revogada ? new Date() : null,
    },
  });
}

async function assinatura(
  tenantId: string,
  dados: {
    status?: "ATIVO" | "TRIAL" | "SUSPENSO";
    activatedAt?: Date | null;
    trialEndsAt?: Date | null;
    currentPeriodEnd?: Date;
  },
) {
  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: dados.status ?? "ATIVO",
      monthlyAmount: 49.9,
      // `??` NÃO serve aqui: `null` é um valor pedido (nunca pagou), e
      // `null ?? default` cairia no default — silenciosamente transformando um
      // cenário de teste grátis em um de empresa paga.
      activatedAt:
        dados.activatedAt === undefined ? new Date("2026-01-10T00:00:00Z") : dados.activatedAt,
      trialEndsAt: dados.trialEndsAt ?? null,
      currentPeriodEnd: dados.currentPeriodEnd ?? dias(10),
      graceDays: 5,
    },
  });
}

/** Só o usuário procurado, ignorando o resto do banco de teste. */
async function buscar(userId: string) {
  const lista = await AdminService.listUsers();
  const achado = lista.find((u) => u.id === userId);
  if (!achado) throw new Error("usuario nao veio na listagem");
  return achado;
}

beforeAll(async () => {
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Presenca",
      slug: `presenca-${uniq()}`,
      priceMonthly: 49.9,
      active: true,
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.user.deleteMany({ where: { id: { in: usuariosSoltos } } });
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
});

describe("presença na lista de usuários", () => {
  it("sessão renovada agora → online", async () => {
    const t = await createTestTenant("PRESENCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Trabalhando");
    await criarSessao(u);

    expect((await buscar(u)).online).toBe(true);
  });

  it("sessão renovada dentro da janela → online", async () => {
    const t = await createTestTenant("PRESENCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Renovou ha pouco");
    await criarSessao(u, { criadaMinutosAtras: JANELA_ONLINE_MINUTOS - 5 });

    expect((await buscar(u)).online).toBe(true);
  });

  it("sessão mais velha que a janela → offline", async () => {
    const t = await createTestTenant("PRESENCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Entrou e foi embora");
    await criarSessao(u, { criadaMinutosAtras: JANELA_ONLINE_MINUTOS + 5 });

    // Token ainda válido por 30 dias, mas sem sinal de atividade recente.
    expect((await buscar(u)).online).toBe(false);
  });

  it("sessão revogada (logout) → offline, mesmo tendo saído agora", async () => {
    const t = await createTestTenant("PRESENCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Saiu agora");
    await criarSessao(u, { revogada: true });

    // É o caso que `lastLoginAt` erraria: o logout não mexe naquela coluna.
    expect((await buscar(u)).online).toBe(false);
  });

  it("sessão expirada → offline", async () => {
    const t = await createTestTenant("PRESENCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Sessao morta");
    await criarSessao(u, { expirada: true });

    expect((await buscar(u)).online).toBe(false);
  });

  it("nunca entrou → offline", async () => {
    const t = await createTestTenant("PRESENCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Nunca entrou");

    expect((await buscar(u)).online).toBe(false);
  });

  it("uma sessão viva basta, mesmo com outras revogadas", async () => {
    const t = await createTestTenant("PRESENCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Rotacionou varias vezes");
    // É o que a rotação produz: a cada renovação a antiga é revogada e nasce uma.
    await criarSessao(u, { criadaMinutosAtras: 40, revogada: true });
    await criarSessao(u, { criadaMinutosAtras: 20, revogada: true });
    await criarSessao(u, { criadaMinutosAtras: 1 });

    expect((await buscar(u)).online).toBe(true);
  });

  it("desativar o usuário derruba a presença (revoga as sessões)", async () => {
    const t = await createTestTenant("PRESENCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Vai ser desativado");
    await criarSessao(u);
    expect((await buscar(u)).online).toBe(true);

    const admin = await criarUsuario(null, "Admin Presenca");
    await AdminService.setUserActive(
      { userId: u, active: false },
      { userId: admin, ip: null, session: { sub: admin } } as Parameters<
        typeof AdminService.setUserActive
      >[1],
    );

    // Sem código extra: `setUserActive` revoga as sessões, e a presença cai junto.
    expect((await buscar(u)).online).toBe(false);
  });
});

describe("situação de cobrança na lista de usuários", () => {
  it("empresa em teste → em_teste com os dias restantes", async () => {
    const t = await createTestTenant("COBRANCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Testando");
    await assinatura(t, { status: "TRIAL", activatedAt: null, trialEndsAt: dias(4) });

    const achado = await buscar(u);
    expect(achado.cobranca?.situacao).toBe("em_teste");
    expect(achado.cobranca?.diasDeTeste).toBe(4);
  });

  it("empresa pagando → em_dia", async () => {
    const t = await createTestTenant("COBRANCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Pagando");
    await assinatura(t, { status: "ATIVO", currentPeriodEnd: dias(10) });

    expect((await buscar(u)).cobranca?.situacao).toBe("em_dia");
  });

  it("mensalidade vencida na tolerância → inadimplente, com o grau VENCIDO", async () => {
    const t = await createTestTenant("COBRANCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Vencido");
    await assinatura(t, { status: "ATIVO", currentPeriodEnd: dias(-2) });

    const achado = await buscar(u);
    expect(achado.cobranca?.situacao).toBe("inadimplente");
    expect(achado.cobranca?.statusEfetivo).toBe("VENCIDO");
  });

  it("classifica pela DATA, não pelo status gravado pelo cron", async () => {
    const t = await createTestTenant("COBRANCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Cron atrasado");
    // Gravado ATIVO, período encerrado há muito: é o estado real entre duas
    // execuções do cron, e é o caso que a tela existe para pegar.
    await assinatura(t, { status: "ATIVO", currentPeriodEnd: dias(-40) });

    const achado = await buscar(u);
    expect(achado.cobranca?.situacao).toBe("inadimplente");
    expect(achado.cobranca?.statusEfetivo).toBe("SUSPENSO");
  });

  it("teste terminado sem pagar → inadimplente", async () => {
    const t = await createTestTenant("COBRANCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Teste acabou");
    await assinatura(t, { status: "TRIAL", activatedAt: null, trialEndsAt: dias(-1) });

    expect((await buscar(u)).cobranca?.situacao).toBe("inadimplente");
  });

  it("empresa sem assinatura → inadimplente, não 'em dia'", async () => {
    const t = await createTestTenant("COBRANCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Sem assinatura");

    const achado = await buscar(u);
    expect(achado.cobranca?.situacao).toBe("inadimplente");
    expect(achado.cobranca?.statusEfetivo).toBeNull();
  });

  it("super-admin (sem empresa) não tem situação de cobrança", async () => {
    const u = await criarUsuario(null, "Admin sem empresa");

    // Contá-lo como inadimplente encheria o painel de fantasmas.
    expect((await buscar(u)).cobranca).toBeNull();
  });

  it("empresa excluída não tem situação de cobrança", async () => {
    const t = await createTestTenant("COBRANCA");
    tenants.push(t);
    const u = await criarUsuario(t, "Empresa excluida");
    await assinatura(t, { status: "ATIVO", currentPeriodEnd: dias(-40) });
    await prisma.tenant.update({ where: { id: t }, data: { deletedAt: new Date() } });

    expect((await buscar(u)).cobranca).toBeNull();
  });
});
