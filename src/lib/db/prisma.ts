import { PrismaClient } from "@prisma/client";

// Singleton para não criar múltiplos clients no hot-reload do Next em dev.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * `prisma` (cru) só deve ser usado em auth, super-admin, billing/webhooks e testes.
 * Nos módulos de negócio use SEMPRE `getTenantPrisma(tenantId)` (isolamento por tenant).
 */
