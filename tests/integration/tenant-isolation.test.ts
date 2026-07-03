import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTenantPrisma } from "@/lib/db/tenant-prisma";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

let tenantA = "";
let tenantB = "";
let productBId = "";

beforeAll(async () => {
  tenantA = await createTestTenant("ISO A");
  tenantB = await createTestTenant("ISO B");
  await getTenantPrisma(tenantA).product.create({ data: { tenantId: tenantA, name: "Produto A", saleUnit: "KG" } });
  const pb = await getTenantPrisma(tenantB).product.create({ data: { tenantId: tenantB, name: "Produto B", saleUnit: "KG" } });
  productBId = pb.id;
});

afterAll(async () => {
  await cleanupTenants([tenantA, tenantB]);
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
});
