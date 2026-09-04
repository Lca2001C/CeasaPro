import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createRefreshToken } from "@/lib/auth/refresh";
import { resolverLoginGoogle } from "@/lib/services/google-login.service";
import { cleanupTenants } from "../helpers/factory";
import type { GoogleProfile } from "@/lib/auth/google-oauth";

/**
 * Login com Google sem falar com o Google: o perfil já veio verificado.
 * O que importa é o que o CeasaPro faz com ele — achar a conta, criar empresa,
 * recusar inativa, e tratar o Google como confirmação de e-mail.
 */

const tenants: string[] = [];
const emails: string[] = [];
let planoId = "";

const uniq = () => `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;

function perfil(over: Partial<GoogleProfile> = {}): GoogleProfile {
  const email = over.email ?? `google-${uniq()}@gmail.com`;
  emails.push(email);
  return {
    sub: over.sub ?? `sub-${uniq()}`,
    email,
    emailVerified: true,
    name: over.name ?? "Hortifrúti Google",
  };
}

beforeAll(async () => {
  const plano = await prisma.plan.create({
    data: {
      name: "Plano Google Teste",
      slug: `google-teste-${uniq()}`,
      priceMonthly: 49,
      active: true,
    },
  });
  planoId = plano.id;
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.plan.deleteMany({ where: { id: planoId } });
});

describe("resolverLoginGoogle", () => {
  it("cria empresa nova, confirma o e-mail e libera o trial", async () => {
    const p = perfil();
    const res = await resolverLoginGoogle(p, { ip: "203.0.113.20" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: res.userId },
      include: { tenant: { include: { subscription: true } } },
    });
    tenants.push(user.tenantId!);
    expect(res.criado).toBe(true);
    expect(user.googleSub).toBe(p.sub);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.tenant?.subscription?.status).toBe("TRIAL");
    expect(user.tenant?.subscription?.trialEndsAt).not.toBeNull();
    expect(user.tenant?.onboardingCompletedAt).toBeNull();
  });

  it("entra na conta existente pelo e-mail e grava o googleSub", async () => {
    const hash = await hashPassword("senha1234");
    const tenant = await prisma.tenant.create({
      data: {
        tradeName: "Box Google Existente",
        status: "ACTIVE",
        onboardingCompletedAt: new Date(),
        subscription: {
          create: {
            planId: planoId,
            status: "ATIVO",
            monthlyAmount: 49,
            activatedAt: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
            graceDays: 5,
          },
        },
      },
    });
    tenants.push(tenant.id);
    const p = perfil();
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Dono",
        email: p.email,
        passwordHash: hash,
        role: "OWNER",
        emailVerifiedAt: new Date(),
      },
    });

    const res = await resolverLoginGoogle(p, { ip: "203.0.113.21" });
    expect(res).toEqual({
      ok: true,
      userId: user.id,
      role: "OWNER",
      criado: false,
    });
    const atualizado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(atualizado.googleSub).toBe(p.sub);
  });

  it("reconhece a conta pelo googleSub mesmo se o nome no Google mudou", async () => {
    const hash = await hashPassword("senha1234");
    const tenant = await prisma.tenant.create({
      data: {
        tradeName: "Box Sub",
        status: "ACTIVE",
        onboardingCompletedAt: new Date(),
        subscription: {
          create: {
            planId: planoId,
            status: "ATIVO",
            monthlyAmount: 49,
            activatedAt: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
            graceDays: 5,
          },
        },
      },
    });
    tenants.push(tenant.id);
    const sub = `sub-fixo-${uniq()}`;
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Antigo",
        email: `antigo-${uniq()}@gmail.com`,
        passwordHash: hash,
        role: "OWNER",
        googleSub: sub,
        emailVerifiedAt: new Date(),
      },
    });
    emails.push(user.email);

    const res = await resolverLoginGoogle(
      { sub, email: `novo-${uniq()}@gmail.com`, emailVerified: true, name: "Novo Nome" },
      { ip: null },
    );
    expect(res.ok && res.userId).toBe(user.id);
    expect(res.ok && res.criado).toBe(false);
  });

  it("recusa conta inativa sem revelar o motivo no código de negócio", async () => {
    const hash = await hashPassword("senha1234");
    const tenant = await prisma.tenant.create({
      data: { tradeName: "Inativa", status: "ACTIVE" },
    });
    tenants.push(tenant.id);
    const p = perfil();
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Inativo",
        email: p.email,
        passwordHash: hash,
        role: "OWNER",
        active: false,
      },
    });

    const res = await resolverLoginGoogle(p, { ip: null });
    expect(res).toEqual({ ok: false, code: "google-inativo" });
  });

  it("confirma cadastro público pendente e libera o trial", async () => {
    const hash = await hashPassword("senha1234");
    const tenant = await prisma.tenant.create({
      data: {
        tradeName: "Pendente Google",
        status: "ACTIVE",
        subscription: {
          create: {
            planId: planoId,
            status: "SUSPENSO",
            monthlyAmount: 49,
            activatedAt: null,
            trialEndsAt: null,
            currentPeriodEnd: new Date(),
            graceDays: 5,
          },
        },
      },
    });
    tenants.push(tenant.id);
    const p = perfil();
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Pendente",
        email: p.email,
        passwordHash: hash,
        role: "OWNER",
        emailVerifiedAt: null,
      },
    });

    const res = await resolverLoginGoogle(p, { ip: "203.0.113.22" });
    expect(res.ok && res.userId).toBe(user.id);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    expect(sub.status).toBe("TRIAL");
    expect(sub.trialEndsAt).not.toBeNull();
    const atualizado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(atualizado.emailVerifiedAt).not.toBeNull();
  });
  /**
   * Sequestro de conta por cadastro plantado ("account pre-hijacking").
   *
   * O cadastro público cria o `User` com a senha de quem preencheu o formulário
   * e `emailVerifiedAt: null`, e o `/api/auth/login` não exige e-mail confirmado.
   * Então dava para se cadastrar com o e-mail de um comerciante, esperar ele
   * entrar pelo botão do Google — que confirma o e-mail e libera o acesso — e
   * depois entrar na empresa dele com a senha plantada.
   */
  describe("cadastro pendente adotado pelo Google", () => {
    async function cadastroPendente(senha: string) {
      const tenant = await prisma.tenant.create({
        data: {
          tradeName: "Plantado",
          status: "ACTIVE",
          subscription: {
            create: {
              planId: planoId,
              status: "SUSPENSO",
              monthlyAmount: 49,
              activatedAt: null,
              trialEndsAt: null,
              currentPeriodEnd: new Date(),
              graceDays: 5,
            },
          },
        },
      });
      tenants.push(tenant.id);
      const p = perfil();
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          name: "Dono",
          email: p.email,
          passwordHash: await hashPassword(senha),
          role: "OWNER",
          emailVerifiedAt: null,
          verifyTokenHash: `pendente-${uniq()}`,
          resetTokenHash: `reset-${uniq()}`,
          resetTokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });
      return { tenant, user, p };
    }

    it("a senha plantada deixa de valer depois do login pelo Google", async () => {
      const { user, p } = await cadastroPendente("senhaDoImpostor1");

      await resolverLoginGoogle(p, { ip: "203.0.113.30" });

      const depois = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await verifyPassword(depois.passwordHash, "senhaDoImpostor1")).toBe(false);
      // E-mail confirmado: o dono real entra pelo Google, ou define senha nova
      // em /recuperar-senha — que agora chega no endereço certo.
      expect(depois.emailVerifiedAt).not.toBeNull();
    });

    it("os tokens de confirmação e de recuperação do impostor são apagados", async () => {
      const { user, p } = await cadastroPendente("senhaDoImpostor2");

      await resolverLoginGoogle(p, { ip: null });

      const depois = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(depois.verifyTokenHash).toBeNull();
      expect(depois.resetTokenHash).toBeNull();
      expect(depois.resetTokenExpiresAt).toBeNull();
    });

    it("a sessão que o impostor já tinha aberto é revogada", async () => {
      const { user, p } = await cadastroPendente("senhaDoImpostor3");
      // Refresh dura 30 dias: sem revogar, ele voltaria mesmo sem a senha.
      await createRefreshToken(user.id, { ip: "198.51.100.9" });

      await resolverLoginGoogle(p, { ip: null });

      const vivos = await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(vivos).toBe(0);
    });

    it("conta JÁ confirmada mantém a senha (é a mesma pessoa, não há impostor)", async () => {
      const { user, p } = await cadastroPendente("senhaLegitima1");
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });

      await resolverLoginGoogle(p, { ip: null });

      const depois = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await verifyPassword(depois.passwordHash, "senhaLegitima1")).toBe(true);
      expect(depois.googleSub).toBe(p.sub);
    });
  });

  it("empresa cadastrada pelo admin não ganha teste grátis ao entrar pelo Google", async () => {
    // `provisionTenant` cria toda empresa SUSPENSA com trialEndsAt/activatedAt
    // nulos, e o cadastro pelo admin decide de propósito não dar os 7 dias
    // (admin.service.ts:134) — só o cadastro público tem teste grátis. Como o
    // admin já confirma o e-mail na criação, é `emailVerifiedAt` que separa os
    // dois casos; sem isso, um clique no botão do Google dava o mês de graça.
    const tenant = await prisma.tenant.create({
      data: {
        tradeName: "Cadastrada pelo admin",
        status: "ACTIVE",
        subscription: {
          create: {
            planId: planoId,
            status: "SUSPENSO",
            monthlyAmount: 49,
            activatedAt: null,
            trialEndsAt: null,
            currentPeriodEnd: new Date(),
            graceDays: 5,
          },
        },
      },
    });
    tenants.push(tenant.id);
    const p = perfil();
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Dono do admin",
        email: p.email,
        passwordHash: await hashPassword("temporaria1"),
        role: "OWNER",
        mustChangePassword: true,
        emailVerifiedAt: new Date(),
      },
    });

    const res = await resolverLoginGoogle(p, { ip: null });
    expect(res.ok).toBe(true);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    expect(sub.status).toBe("SUSPENSO");
    expect(sub.trialEndsAt).toBeNull();
  });
  it("cliente que teve a conta excluída consegue voltar pelo Google", async () => {
    // Estado que a produção já tem: contas excluídas antes da correção seguem
    // ocupando o `googleSub` (@unique) na linha soft-deletada. Sem liberar o
    // valor, o passo 3 estourava violação de índice dentro da transação e o
    // callback — que não tem try/catch — devolvia 500 a cada tentativa.
    const p = perfil();
    const antigo = await prisma.user.create({
      data: {
        name: "Conta antiga",
        email: `excluido-cuid-antigo-${uniq()}@teste.com`,
        passwordHash: "x",
        role: "OWNER",
        googleSub: p.sub,
        deletedAt: new Date(),
        active: false,
      },
    });
    emails.push(antigo.email);

    const res = await resolverLoginGoogle(p, { ip: "203.0.113.40" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.criado).toBe(true);

    const novo = await prisma.user.findUniqueOrThrow({ where: { id: res.userId } });
    tenants.push(novo.tenantId!);
    expect(novo.googleSub).toBe(p.sub);
    // A linha velha continua excluída, agora sem o vínculo.
    const velha = await prisma.user.findUniqueOrThrow({ where: { id: antigo.id } });
    expect(velha.googleSub).toBeNull();
    expect(velha.deletedAt).not.toBeNull();
  });
  it("cliente excluído que se recadastrou por senha também volta pelo Google", async () => {
    // Mesmo vínculo preso, outro caminho: ele voltou pelo cadastro comum e
    // depois clicou no botão do Google. Aqui o passo 2 acha a linha nova pelo
    // e-mail e grava o `googleSub` — que a linha excluída ainda ocupava.
    const p = perfil();
    const antigo = await prisma.user.create({
      data: {
        name: "Conta antiga",
        email: `excluido-cuid-recad-${uniq()}@teste.com`,
        passwordHash: "x",
        role: "OWNER",
        googleSub: p.sub,
        deletedAt: new Date(),
        active: false,
      },
    });
    emails.push(antigo.email);

    const tenant = await prisma.tenant.create({
      data: {
        tradeName: "Recadastrada",
        status: "ACTIVE",
        subscription: {
          create: {
            planId: planoId,
            status: "SUSPENSO",
            monthlyAmount: 49,
            currentPeriodEnd: new Date(),
            graceDays: 5,
          },
        },
      },
    });
    tenants.push(tenant.id);
    const vivo = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "De volta",
        email: p.email,
        passwordHash: await hashPassword("senhaDele1"),
        role: "OWNER",
        emailVerifiedAt: new Date(),
      },
    });

    const res = await resolverLoginGoogle(p, { ip: null });
    expect(res.ok && res.userId).toBe(vivo.id);

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: vivo.id } });
    expect(depois.googleSub).toBe(p.sub);
  });
});
