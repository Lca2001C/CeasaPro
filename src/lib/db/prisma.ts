import { Prisma, PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

// Segredos fora de todo resultado de leitura. O `omit` só tira o campo do
// objeto devolvido: `where` e `data` continuam usando esses campos. Quem
// precisa LER o segredo pede de volta naquela query com `omit: { campo: false }`.
// `satisfies` (e não anotação de tipo) mantém o `true` literal — alargado para
// `boolean`, o tipo do client voltaria a expor os campos omitidos.
const prismaOptions = {
  log: [
    { emit: "stdout", level: "error" },
    ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout" as const, level: "warn" as const }] : []),
    // Evento (não stdout): quem decide o que registrar é o `$on("query")` abaixo.
    { emit: "event", level: "query" },
  ],
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

/*
  Consulta lenta vira log — em produção também.

  Antes nada media tempo de consulta: sem isso, "o app ficou lento" não tinha
  como ser respondido com dado. Registra a duração e o SQL TRUNCADO, nunca os
  parâmetros (que carregam nome de cliente, valores, e-mail). O limite vem de
  `PRISMA_SLOW_MS` (padrão 300 ms).

  `PRISMA_CONTAR_CONSULTAS=1` (só para medir em dev) imprime UMA linha por
  consulta, para contar quantas idas ao banco cada tela faz.
*/
if (!globalForPrisma.prisma) {
  const lenta = Number(process.env.PRISMA_SLOW_MS ?? 300);
  const contar = process.env.PRISMA_CONTAR_CONSULTAS === "1";
  prisma.$on("query", (e) => {
    if (contar) console.log(`[consulta] ${e.duration}ms ${e.query.slice(0, 140).replace(/\s+/g, " ")}`);
    if (e.duration >= lenta) {
      logger.warn({ ms: e.duration, sql: e.query.replace(/\s+/g, " ").slice(0, 300) }, "Consulta lenta");
    }
  });
}

// Reusa o client em hot-reload (dev) e em instâncias quentes da Vercel.
globalForPrisma.prisma = prisma;

/**
 * `prisma` (cru) só deve ser usado em auth, super-admin, billing/webhooks e testes.
 * Nos módulos de negócio use SEMPRE `getTenantPrisma(tenantId)` (isolamento por tenant).
 */
