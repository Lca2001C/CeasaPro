import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { PlanoService } from "@/lib/services/plano.service";
import { createTestTenant, cleanupTenants, makeCtx } from "../helpers/factory";

let tenantId = "";
const planIds: string[] = [];
let basicoId = "";
let completoId = "";
let inativoId = "";
let semUsuariosId = "";

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  tenantId = await createTestTenant("TROCA PLANO");

  const basico = await prisma.plan.create({
    data: {
      name: "Básico Teste",
      slug: `basico-${uniq()}`,
      priceMonthly: 29.9,
      maxUsers: 3,
      active: true,
      features: { modules: [] }, // só núcleo
    },
  });
  const completo = await prisma.plan.create({
    data: {
      name: "Completo Teste",
      slug: `completo-${uniq()}`,
      priceMonthly: 99.9,
      maxUsers: 10,
      active: true,
      features: { modules: ["caixas", "higienizacao", "embalagens", "relatorios_avancados"] },
    },
  });
  const inativo = await prisma.plan.create({
    data: { name: "Inativo Teste", slug: `inativo-${uniq()}`, priceMonthly: 10, active: false },
  });
  const semUsuarios = await prisma.plan.create({
    data: { name: "Zero Users Teste", slug: `zero-${uniq()}`, priceMonthly: 5, maxUsers: 1, active: true },
  });
  basicoId = basico.id;
  completoId = completo.id;
  inativoId = inativo.id;
  semUsuariosId = semUsuarios.id;
  planIds.push(basicoId, completoId, inativoId, semUsuariosId);

  // Assinatura inicial no Básico + 2 usuários (OWNER + 1).
  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: basicoId,
      status: "ATIVO",
      monthlyAmount: 29.9,
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      graceDays: 5,
    },
  });
  await prisma.user.createMany({
    data: [
      { tenantId, name: "Dono", email: `dono-${uniq()}@t.com`, passwordHash: "x", role: "OWNER" },
      { tenantId, name: "Func", email: `func-${uniq()}@t.com`, passwordHash: "x", role: "OWNER" },
    ],
  });
});

afterAll(async () => {
  await cleanupTenants([tenantId]);
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
});

describe("Troca de plano pelo cliente (OWNER)", () => {
  it("listAvailablePlans traz os planos ativos e marca o atual; ignora inativos", async () => {
    const plans = await PlanoService.listAvailablePlans(tenantId);
    const ids = plans.map((p) => p.id);
    expect(ids).toContain(basicoId);
    expect(ids).toContain(completoId);
    expect(ids).not.toContain(inativoId); // inativo não é ofertado
    expect(plans.find((p) => p.id === basicoId)?.isCurrent).toBe(true);
    expect(plans.find((p) => p.id === completoId)?.isCurrent).toBe(false);
    // rótulos de módulos do plano completo
    expect(plans.find((p) => p.id === completoId)?.modules.length).toBe(4);
  });

  it("troca para outro plano: atualiza planId e o valor mensal (vindo do plano)", async () => {
    const res = await PlanoService.changePlan(completoId, makeCtx(tenantId));
    expect(res.planName).toBe("Completo Teste");
    expect(res.monthlyAmount).toBe(99.9);

    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.planId).toBe(completoId);
    expect(Number(sub?.monthlyAmount)).toBe(99.9);
    // não mexe no vencimento nem no status
    expect(sub?.status).toBe("ATIVO");
    expect(sub?.currentPeriodEnd.toISOString()).toBe(new Date("2026-09-01T00:00:00Z").toISOString());
  });

  it("registra auditoria da troca", async () => {
    const log = await prisma.auditLog.findFirst({
      where: { tenantId, entity: "TenantSubscription", action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toBeTruthy();
  });

  it("recusa trocar para o plano que já é o atual", async () => {
    await expect(PlanoService.changePlan(completoId, makeCtx(tenantId))).rejects.toThrow(
      /já é o seu plano/i,
    );
  });

  it("recusa plano inexistente ou inativo", async () => {
    await expect(PlanoService.changePlan("nao-existe", makeCtx(tenantId))).rejects.toThrow(
      /indisponível/i,
    );
    await expect(PlanoService.changePlan(inativoId, makeCtx(tenantId))).rejects.toThrow(
      /indisponível/i,
    );
  });

  it("bloqueia downgrade que estoura o limite de usuários do novo plano", async () => {
    // Empresa tem 2 usuários; plano permite só 1.
    await expect(PlanoService.changePlan(semUsuariosId, makeCtx(tenantId))).rejects.toThrow(
      /usuário/i,
    );
    // Continua no plano completo (troca não aconteceu).
    const sub = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    expect(sub?.planId).toBe(completoId);
  });
});
