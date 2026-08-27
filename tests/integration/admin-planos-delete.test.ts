import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AdminService } from "@/lib/services/admin.service";
import { createTestTenant, cleanupTenants } from "../helpers/factory";
import type { AdminCtx } from "@/lib/http/with-action";

const uniq = () => Math.random().toString(36).slice(2, 8);
const tenants: string[] = [];
const planos: string[] = [];

const ctx: AdminCtx = {
  userId: "admin-teste",
  ip: null,
  session: {
    sub: "admin-teste",
    role: "SUPER_ADMIN",
    tenantId: null,
    email: "admin@ceasapro.com.br",
    name: "Admin",
    mustChangePassword: false,
    tenantStatus: null,
    subStatus: null,
  },
};

async function criarPlano(nome: string) {
  const p = await prisma.plan.create({
    data: { name: nome, slug: `${uniq()}`, priceMonthly: 49.9, active: true },
  });
  planos.push(p.id);
  return p;
}

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.plan.deleteMany({ where: { id: { in: planos } } });
});

describe("Exclusão de plano (super-admin)", () => {
  it("exclui um plano que ninguém usa e registra na auditoria", async () => {
    const plano = await criarPlano("Plano Descartável");

    const r = await AdminService.deletePlan(plano.id, ctx);
    expect(r.name).toBe("Plano Descartável");

    expect(await prisma.plan.findUnique({ where: { id: plano.id } })).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { entity: "Plan", entityId: plano.id, action: "DELETE" },
    });
    expect(log).toBeTruthy();
  });

  it("recusa excluir plano em uso e diz quantas assinaturas dependem dele", async () => {
    const plano = await criarPlano("Plano Em Uso");
    const tenantId = await createTestTenant("PLANO EM USO");
    tenants.push(tenantId);
    await prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: plano.id,
        status: "ATIVO",
        monthlyAmount: 49.9,
        currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
        graceDays: 5,
      },
    });

    await expect(AdminService.deletePlan(plano.id, ctx)).rejects.toThrow(/1 assinatura/i);

    // O plano continua lá: apagá-lo apagaria a prova de quanto a empresa paga.
    expect(await prisma.plan.findUnique({ where: { id: plano.id } })).not.toBeNull();
  });

  it("recusa plano inexistente", async () => {
    await expect(AdminService.deletePlan("nao-existe", ctx)).rejects.toThrow(
      /não encontrado/i,
    );
  });

  it("explica quando o bloqueio vem de empresa EXCLUÍDA, não de cliente ativo", async () => {
    // A FK é Restrict: a assinatura sobrevive ao soft delete do tenant e
    // continua barrando. A mensagem antiga dizia "está em 1 assinatura(s)",
    // mandando o super-admin procurar um cliente que não existe mais.
    const plano = await criarPlano("Plano Orfao");
    const tenantId = await createTestTenant("EMPRESA EXCLUIDA");
    tenants.push(tenantId);
    await prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: plano.id,
        status: "ATIVO",
        monthlyAmount: 10,
        currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
        graceDays: 5,
      },
    });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { deletedAt: new Date() },
    });

    await expect(AdminService.deletePlan(plano.id, ctx)).rejects.toThrow(/excluída/i);
    expect(await prisma.plan.findUnique({ where: { id: plano.id } })).not.toBeNull();
  });
});

describe("Plano interno do ambiente do super-admin", () => {
  it("não aparece na lista de planos comerciais", async () => {
    const interno = await prisma.plan.upsert({
      where: { slug: "ambiente-administrador" },
      update: {},
      create: {
        name: "Ambiente do administrador",
        slug: "ambiente-administrador",
        priceMonthly: 0,
        active: false,
      },
    });

    const lista = await AdminService.listPlans();
    expect(lista.some((p) => p.id === interno.id)).toBe(false);
  });

  it("não pode ser editado nem excluído", async () => {
    const interno = await prisma.plan.findUniqueOrThrow({
      where: { slug: "ambiente-administrador" },
    });
    await expect(AdminService.deletePlan(interno.id, ctx)).rejects.toThrow(/interno/i);
    await expect(
      AdminService.updatePlan(
        {
          id: interno.id,
          name: "Hackeado",
          priceMonthly: 999,
          maxUsers: null,
          active: true,
          modules: [],
        },
        ctx,
      ),
    ).rejects.toThrow(/interno/i);
  });
});
