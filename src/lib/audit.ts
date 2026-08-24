import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "PAYMENT"
  | "STATUS_CHANGE"
  /** Pediu o link de "esqueci minha senha" (o e-mail existia e a conta estava ativa). */
  | "PASSWORD_RESET_REQUESTED"
  /** Senha efetivamente redefinida pelo link do e-mail. */
  | "PASSWORD_RESET"
  /** Acesso cortado e sessões revogadas (estorno, chargeback, bloqueio). */
  | "ACCESS_REVOKED";

export interface AuditInput {
  tenantId?: string | null;
  userId?: string | null;
  actorEmail?: string | null;
  action: AuditAction | string;
  entity: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
  ip?: string | null;
}

// Cliente mínimo que expõe auditLog.create (base prisma OU tx de transação).
type AuditClient = {
  auditLog: { create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown> };
};

/**
 * Grava um registro de auditoria. Pode receber o `tx` de uma transação para
 * ficar atômico com a operação de negócio. Falha de auditoria é logada mas
 * não derruba a operação principal (best-effort fora de tx; dentro de tx propaga).
 */
export async function audit(
  input: AuditInput,
  db: AuditClient = prisma as unknown as AuditClient,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        oldData: (input.oldData ?? undefined) as Prisma.InputJsonValue | undefined,
        newData: (input.newData ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: input.ip ?? null,
      },
    });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "Falha ao gravar auditoria");
    if (db !== (prisma as unknown as AuditClient)) throw e; // dentro de tx, propaga
  }
}
