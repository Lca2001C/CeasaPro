import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

let tenantA = "";
let tenantB = "";
let productBId = "";
let chargebackPlanId = "";

beforeAll(async () => {
  tenantA = await createTestTenant("ISO A");
  tenantB = await createTestTenant("ISO B");
  await getTenantPrisma(tenantA).product.create({ data: { tenantId: tenantA, name: "Produto A", saleUnit: "KG" } });
  const pb = await getTenantPrisma(tenantB).product.create({ data: { tenantId: tenantB, name: "Produto B", saleUnit: "KG" } });
  productBId = pb.id;
  const plan = await prisma.plan.create({
    data: {
      name: "Plano Teste Isolamento",
      slug: `teste-isolamento-${Date.now()}`,
      priceMonthly: 49.9,
      active: true,
    },
  });
  chargebackPlanId = plan.id;
});

afterAll(async () => {
  await cleanupTenants([tenantA, tenantB]);
  await prisma.plan.delete({ where: { id: chargebackPlanId } }).catch(() => {});
});

describe("Isolamento por tenant", () => {
  it("A só enxerga os próprios produtos", async () => {
    const list = await getTenantPrisma(tenantA).product.findMany();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("Produto A");
  });

  it("A não consegue ler registro de B (retorna null)", async () => {
    const found = await getTenantPrisma(tenantA).product.findFirst({ where: { id: productBId } });
    expect(found).toBeNull();
  });

  it("A não consegue atualizar registro de B (0 linhas afetadas)", async () => {
    const res = await getTenantPrisma(tenantA).product.updateMany({
      where: { id: productBId },
      data: { name: "HACKEADO" },
    });
    expect(res.count).toBe(0);
    const stillB = await getTenantPrisma(tenantB).product.findFirst({ where: { id: productBId } });
    expect(stillB!.name).toBe("Produto B");
  });

  it("create força o tenantId da sessão, ignorando tenantId forjado", async () => {
    const created = await getTenantPrisma(tenantA).product.create({
      // tenta forjar o tenant de B — a extensão deve sobrescrever para A
      data: { tenantId: tenantB, name: "Forjado", saleUnit: "UNIDADE" },
    });
    expect(created.tenantId).toBe(tenantA);
  });

  it("bloqueio de uma empresa por chargeback não afeta os dados da vizinha", async () => {
    // O bloqueio por reversão de pagamento acontece na assinatura, não nos
    // dados: o corte de acesso é do tenant bloqueado e nada vaza para o outro.
    await prisma.tenantSubscription.create({
      data: {
        tenantId: tenantA,
        planId: chargebackPlanId,
        status: "BLOQUEADO",
        statusSource: "MANUAL",
        statusReason: "Pagamento charged_back no Mercado Pago (mp-iso)",
        monthlyAmount: 49.9,
        activatedAt: new Date("2026-07-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
        graceDays: 5,
      },
    });

    const bloqueada = await prisma.tenantSubscription.findUnique({ where: { tenantId: tenantA } });
    expect(bloqueada?.status).toBe("BLOQUEADO");

    const deB = await getTenantPrisma(tenantB).product.findMany();
    expect(deB.map((p) => p.name)).toContain("Produto B");
    expect(deB.every((p) => p.tenantId === tenantB)).toBe(true);

    // E a vizinha continua sem enxergar nada de A, inclusive o item forjado.
    const deA = await getTenantPrisma(tenantA).product.findMany();
    expect(deA.some((p) => p.tenantId === tenantB)).toBe(false);
  });
});
