import type { Prisma } from "@prisma/client";

/**
 * Travas de linha que serializam plano, assinatura e aprovação de pagamento.
 *
 * Três caminhos decidem o que uma empresa paga e recebe: a troca de plano pelo
 * cliente, a edição do plano pelo super-admin e a aprovação do pagamento. Cada
 * um lia o estado e depois escrevia, e entre as duas coisas cabia o outro:
 *
 *  - o cliente agendava a troca para um plano enquanto o admin o desativava — a
 *    contagem de agendamentos do admin não via o agendamento ainda não
 *    commitado, a desativação passava e a virada descartava a troca;
 *  - o webhook conferia o valor devido, o cliente subia de plano, e o
 *    pagamento do plano barato creditava o mês já no plano caro.
 *
 * Com as transações travando a mesma linha, um dos dois espera o commit do
 * outro e relê o estado já decidido. Os dois resultados possíveis estão certos;
 * o interleaving é que não estava.
 *
 * Ordem: quem precisa das duas trava a ASSINATURA antes do plano (`changePlan`).
 * O admin trava o plano e escreve só em assinaturas que estão NESTE plano; a
 * troca trava o plano ALVO, que nunca é o plano vigente da assinatura travada —
 * então não há ciclo.
 */

type ComRaw = { $queryRaw: Prisma.TransactionClient["$queryRaw"] };

/** `SELECT … FOR UPDATE` na assinatura. Use dentro de `$transaction`. */
export async function travarAssinatura(
  tx: ComRaw,
  por: { id: string } | { tenantId: string },
): Promise<void> {
  if ("id" in por) {
    await tx.$queryRaw`SELECT id FROM tenant_subscriptions WHERE id = ${por.id} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM tenant_subscriptions WHERE "tenantId" = ${por.tenantId} FOR UPDATE`;
  }
}

/**
 * Trava a linha do plano. `UPDATE` para quem o altera (edição, desativação,
 * exclusão); `SHARE` para quem só precisa que ele não mude até o commit (a troca
 * que lê `active` e grava o agendamento).
 */
export async function travarPlano(
  tx: ComRaw,
  planId: string,
  modo: "UPDATE" | "SHARE",
): Promise<void> {
  if (modo === "UPDATE") {
    await tx.$queryRaw`SELECT id FROM plans WHERE id = ${planId} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM plans WHERE id = ${planId} FOR SHARE`;
  }
}
