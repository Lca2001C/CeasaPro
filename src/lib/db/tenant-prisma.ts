import { prisma } from "./prisma";
import {
  TENANT_MODELS,
  SOFT_DELETE_MODELS,
  isReadOp,
  isWhereWriteOp,
} from "./models-tenant";

/**
 * Retorna um Prisma Client "escopado" a um tenant.
 * Toda query em models operacionais recebe automaticamente:
 *  - `where.tenantId` = tenantId  (força, ignora qualquer tenantId vindo de fora)
 *  - `where.deletedAt = null`     (esconde registros com soft delete)
 *  - `data.tenantId` = tenantId   (em create/createMany)
 *
 * Assim é impossível esquecer o filtro de tenant → fecha vazamento cross-tenant.
 * Usa `extendedWhereUnique` (GA no Prisma 5+/6): permite combinar id + tenantId em update/delete/findUnique.
 */
export function getTenantPrisma(tenantId: string) {
  if (!tenantId) {
    throw new Error("getTenantPrisma: tenantId é obrigatório");
  }

  return prisma.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }
          const softDelete = SOFT_DELETE_MODELS.has(model);

          if (isReadOp(operation) || isWhereWriteOp(operation)) {
            args.where = { ...(args.where ?? {}), tenantId };
            if (softDelete && operation !== "upsert") {
              // só nas leituras/writes escondemos deletados;
              // (não filtra em upsert.where pois precisa do unique puro)
              if (args.where.deletedAt === undefined) {
                args.where.deletedAt = null;
              }
            }
          }

          if (operation === "create") {
            args.data = { ...(args.data ?? {}), tenantId };
          }

          if (operation === "createMany") {
            const data = args.data;
            args.data = Array.isArray(data)
              ? data.map((d: Record<string, unknown>) => ({ ...d, tenantId }))
              : { ...data, tenantId };
          }

          if (operation === "upsert") {
            args.create = { ...(args.create ?? {}), tenantId };
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof getTenantPrisma>;
