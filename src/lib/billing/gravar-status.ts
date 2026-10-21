import "server-only";
import type { SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Grava o status RECALCULADO só se a assinatura não mudou desde a leitura.
 *
 * O recálculo lê, calcula e grava; entre a leitura e a gravação cabe um
 * webhook de chargeback (BLOQUEADO/MANUAL) ou uma aprovação. O `update` sem
 * condição gravava o status calculado da linha VELHA por cima: um chargeback
 * virava `VENCIDO` + `MANUAL` — e como MANUAL vence o cálculo, o cliente com
 * chargeback seguia usando o sistema para sempre. O `updatedAt` na condição
 * pega qualquer escrita no meio; perdeu a corrida, o próximo recálculo (cron,
 * login, refresh) parte da linha nova.
 */
export async function gravarStatusCalculado(
  sub: { id: string; updatedAt: Date },
  status: SubscriptionStatus,
): Promise<boolean> {
  const { count } = await prisma.tenantSubscription.updateMany({
    where: { id: sub.id, updatedAt: sub.updatedAt },
    data: { status },
  });
  return count === 1;
}
