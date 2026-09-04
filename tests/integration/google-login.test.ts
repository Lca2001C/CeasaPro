import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
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
});
