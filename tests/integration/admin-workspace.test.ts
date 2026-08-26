import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AdminService } from "@/lib/services/admin.service";
import { cleanupTenants } from "../helpers/factory";
import type { AdminCtx } from "@/lib/http/with-action";

/**
 * Ambiente próprio do super-admin: ele usa o sistema num tenant dele, nunca no
 * de um cliente, e esse tenant não pode contaminar as métricas da plataforma.
 */
const uniq = () => Math.random().toString(36).slice(2, 8);
const criados: string[] = [];
const usuarios: string[] = [];

async function superAdminCtx(): Promise<AdminCtx> {
  const email = `admin-${uniq()}@ceasapro.com.br`;
  const user = await prisma.user.create({
    data: { name: "Super Admin", email, passwordHash: "x", role: "SUPER_ADMIN" },
  });
  usuarios.push(user.id);
  return {
    userId: user.id,
    ip: null,
    session: {
      sub: user.id,
      role: "SUPER_ADMIN",
      tenantId: null,
      email,
      name: user.name,
      mustChangePassword: false,
      tenantStatus: null,
      subStatus: null,
    },
  };
}

afterAll(async () => {
  await cleanupTenants(criados);
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.plan.deleteMany({ where: { slug: "ambiente-administrador" } });
});

describe("Ambiente próprio do super-admin", () => {
  it("provisiona o tenant, liga o usuário e deixa a assinatura sempre ativa", async () => {
    const ctx = await superAdminCtx();
    const { tenantId, criado } = await AdminService.getOrCreateAdminWorkspace(ctx);
    criados.push(tenantId);

    expect(criado).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    expect(user.tenantId).toBe(tenantId);

    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("ATIVO");
    // MANUAL é o que impede o cron diário de expirar o ambiente.
    expect(sub.statusSource).toBe("MANUAL");
    expect(sub.currentPeriodEnd.getFullYear()).toBeGreaterThan(new Date().getFullYear() + 10);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    // Sem wizard de onboarding: quem administra a plataforma já sabe usá-la.
    expect(tenant.onboardingCompletedAt).toBeTruthy();
  });

  it("é idempotente: chamar de novo devolve o mesmo ambiente", async () => {
    const ctx = await superAdminCtx();
    const primeira = await AdminService.getOrCreateAdminWorkspace(ctx);
    criados.push(primeira.tenantId);

    const segunda = await AdminService.getOrCreateAdminWorkspace(ctx);
    expect(segunda.tenantId).toBe(primeira.tenantId);
    expect(segunda.criado).toBe(false);

    const quantos = await prisma.tenant.count({
      where: { id: { in: criados }, users: { some: { id: ctx.userId } } },
    });
    expect(quantos).toBe(1);
  });

  it("o plano interno não é ofertado a cliente nenhum", async () => {
    const ctx = await superAdminCtx();
    const { tenantId } = await AdminService.getOrCreateAdminWorkspace(ctx);
    criados.push(tenantId);

    const plan = await prisma.plan.findUniqueOrThrow({
      where: { slug: "ambiente-administrador" },
    });
    // `listAvailablePlans` filtra por `active: true`.
    expect(plan.active).toBe(false);
  });

  it("não aparece na lista de clientes nem nas métricas da plataforma", async () => {
    const ctx = await superAdminCtx();
    const { tenantId } = await AdminService.getOrCreateAdminWorkspace(ctx);
    criados.push(tenantId);

    const antes = await AdminService.metrics();
    const lista = await AdminService.listTenants();
    expect(lista.some((t) => t.id === tenantId)).toBe(false);

    // Também não pode ser aberto como se fosse um cliente.
    await expect(AdminService.getTenant(tenantId)).rejects.toThrow(/não encontrada/i);

    // E não infla a contagem de empresas nem entra no MRR (mensalidade 0).
    const contagemReal = await prisma.tenant.count({
      where: { deletedAt: null, users: { none: { role: "SUPER_ADMIN" } } },
    });
    expect(antes.totalTenants).toBe(contagemReal);
  });
});
