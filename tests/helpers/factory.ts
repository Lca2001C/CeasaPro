import { prisma } from "@/lib/db/prisma";
import type { TenantCtx } from "@/lib/http/with-action";

export function makeCtx(tenantId: string, userId = "test-user"): TenantCtx {
  return {
    tenantId,
    userId,
    ip: null,
    session: {
      sub: userId,
      role: "OWNER",
      tenantId,
      email: "teste@ceasapro.com.br",
      name: "Teste",
      tenantStatus: "ACTIVE",
      subStatus: "ATIVO",
    },
  };
}

export async function createTestTenant(name: string): Promise<string> {
  const t = await prisma.tenant.create({
    data: { tradeName: name, status: "ACTIVE", onboardingCompletedAt: new Date() },
  });
  return t.id;
}

export async function cleanupTenants(ids: string[]) {
  if (ids.length === 0) return;
  const where = { tenantId: { in: ids } };
  // Ordem respeita as FKs Restrict de Product (movimentos/itens antes dos produtos).
  await prisma.auditLog.deleteMany({ where });
  await prisma.plasticCrateMovement.deleteMany({ where });
  await prisma.crateCleaning.deleteMany({ where });
  await prisma.packagingSale.deleteMany({ where });
  await prisma.packagingType.deleteMany({ where });
  await prisma.stockMovement.deleteMany({ where });
  await prisma.creditPayment.deleteMany({ where });
  await prisma.creditAccount.deleteMany({ where });
  await prisma.saleItem.deleteMany({ where });
  await prisma.sale.deleteMany({ where });
  await prisma.purchaseItem.deleteMany({ where });
  await prisma.purchase.deleteMany({ where });
  await prisma.expense.deleteMany({ where });
  await prisma.expenseCategory.deleteMany({ where });
  await prisma.product.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}
