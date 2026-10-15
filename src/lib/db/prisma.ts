import { Prisma, PrismaClient } from "@prisma/client";

// Segredos fora de todo resultado de leitura. O `omit` só tira o campo do
// objeto devolvido: `where` e `data` continuam usando esses campos. Quem
// precisa LER o segredo pede de volta naquela query com `omit: { campo: false }`.
// `satisfies` (e não anotação de tipo) mantém o `true` literal — alargado para
// `boolean`, o tipo do client voltaria a expor os campos omitidos.
const prismaOptions = {
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  omit: {
    user: {
      passwordHash: true,
      resetTokenHash: true,
      verifyTokenHash: true,
      googleSub: true,
    },
    refreshToken: {
      tokenHash: true,
    },
  },
} satisfies Prisma.PrismaClientOptions;

// Singleton para não criar múltiplos clients no hot-reload do Next em dev.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient<typeof prismaOptions> | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaOptions);

// Reusa o client em hot-reload (dev) e em instâncias quentes da Vercel.
globalForPrisma.prisma = prisma;

/**
 * `prisma` (cru) só deve ser usado em auth, super-admin, billing/webhooks e testes.
 * Nos módulos de negócio use SEMPRE `getTenantPrisma(tenantId)` (isolamento por tenant).
 */
