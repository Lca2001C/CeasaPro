import { prisma } from "@/lib/db/prisma";
import { ALL_OPTIONAL_KEYS } from "@/lib/plan/modules";
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
      mustChangePassword: false,
      tenantStatus: "ACTIVE",
      subStatus: "ATIVO",
      // Explícito desde que `isModuleEnabled` passou a ser fail-closed: antes,
      // omitir o claim liberava tudo, e o teste passava por causa do fail-open —
      // não por representar um OWNER de verdade. Um OWNER com plano completo é o
      // que estes testes querem simular.
      modules: [...ALL_OPTIONAL_KEYS],
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
  // Sem FK para Tenant (o registro sobrevive à exclusão da empresa, por design),
  // então não cai por cascata: apagar aqui evita vazar linhas entre testes.
  await prisma.adminNotification.deleteMany({ where });
  await prisma.plasticCrateMovement.deleteMany({ where });
  await prisma.crateCleaningPayment.deleteMany({ where });
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
