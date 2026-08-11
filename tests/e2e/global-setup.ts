import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Prepara o banco para os testes E2E: garante que a empresa demo exista, com
 * onboarding concluído e um produto "Tomate E2E" com estoque suficiente (para o PDV).
 * Idempotente. Exige que `npm run db:seed` já tenha rodado (cria a empresa demo).
 */
export default async function globalSetup() {
  const prisma = new PrismaClient();
  try {
    const owner = await prisma.user.findFirst({
      where: { email: "demo@ceasapro.com.br" },
      include: { tenant: true },
    });
    if (!owner?.tenant) {
      throw new Error(
        "Empresa demo não encontrada. Rode `npm run db:seed` (com SEED_DEMO=true) antes dos testes E2E.",
      );
    }
    const tenantId = owner.tenant.id;

    if (!owner.tenant.onboardingCompletedAt) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { onboardingCompletedAt: new Date() },
      });
    }

    let product = await prisma.product.findFirst({
      where: { tenantId, name: "Tomate E2E", deletedAt: null },
    });
    if (!product) {
      product = await prisma.product.create({
        data: { tenantId, name: "Tomate E2E", saleUnit: "CAIXA", active: true },
      });
    }

    const agg = await prisma.stockMovement.groupBy({
      by: ["type"],
      where: { tenantId, productId: product.id },
      _sum: { quantity: true },
    });
    const saldo = agg.reduce((acc, r) => {
      const q = Number(r._sum.quantity ?? 0);
      return ["ENTRADA", "AJUSTE"].includes(r.type) ? acc + q : acc - q;
    }, 0);
    if (saldo < 50) {
      await prisma.stockMovement.create({
        data: {
          tenantId,
          productId: product.id,
          type: "ENTRADA",
          quantity: 1000,
          unitCost: 2,
          sourceType: "MANUAL",
          reason: "Estoque para testes E2E",
        },
      });
    }

    console.log("[e2e] setup ok — tenant demo + produto 'Tomate E2E' com estoque.");
  } finally {
    await prisma.$disconnect();
  }
}
