import { prisma } from "./prisma";
import {
  TENANT_MODELS,
  SOFT_DELETE_MODELS,
  isReadOp,
  isWhereWriteOp,
  isKnownTenantOp,
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
/**
 * Devolve o payload sem `tenantId` nem a relação `tenant` (um
 * `tenant: { connect: { id } }` move o registro tanto quanto o escalar), sem
 * mutar o objeto de quem chamou.
 */
function semTenantId(payload: unknown): unknown {
  if (
    !payload ||
    typeof payload !== "object" ||
    (!("tenantId" in payload) && !("tenant" in payload))
  ) {
    return payload;
  }
  const copia = { ...(payload as Record<string, unknown>) };
  delete copia.tenantId;
  delete copia.tenant;
  return copia;
}

/** `createMany`/`createManyAndReturn` aceitam objeto único ou lista. */
function carimbaTenant(data: unknown, tenantId: string): unknown {
  return Array.isArray(data)
    ? data.map((d: Record<string, unknown>) => ({ ...semTenantIdObj(d), tenantId }))
    : { ...semTenantIdObj(data), tenantId };
}

function semTenantIdObj(payload: unknown): Record<string, unknown> {
  return (semTenantId(payload ?? {}) ?? {}) as Record<string, unknown>;
}

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
          if (!isKnownTenantOp(operation)) {
            // Nega por padrão: operação sem regra de escopo não roda num model
            // de empresa (ver `isKnownTenantOp`).
            throw new Error(
              `getTenantPrisma: operação "${operation}" em ${model} não é escopada por tenant`,
            );
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

          // Só o tenantId da SESSÃO pode valer. A extensão já força o `where`,
          // mas sem isto um `tenantId` que chegasse no `data` de um update
          // moveria o registro para outra empresa — o filtro impede ler o que
          // é de outro, não impede entregar o próprio. Hoje nenhum serviço
          // espalha entrada do usuário em `data`, então isto fecha a porta
          // antes de alguém abrir: vale por construção, não por disciplina.
          if (
            operation === "update" ||
            operation === "updateMany" ||
            operation === "updateManyAndReturn"
          ) {
            args.data = semTenantId(args.data);
          }
          if (operation === "upsert") {
            args.update = semTenantId(args.update);
          }

          if (operation === "create") {
            args.data = { ...semTenantIdObj(args.data), tenantId };
          }

          if (operation === "createMany" || operation === "createManyAndReturn") {
            args.data = carimbaTenant(args.data, tenantId);
          }

          if (operation === "upsert") {
            args.create = { ...semTenantIdObj(args.create), tenantId };
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof getTenantPrisma>;
