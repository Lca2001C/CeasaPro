import type { Prisma } from "@prisma/client";
import { cancelPayment, isMercadoPagoConfigured } from "@/lib/payments/mercadopago";
import { describeError, logger } from "@/lib/logger";

/**
 * Baixa de cobranças PENDENTES da mensalidade — nos dois lados.
 *
 * Toda vez que uma cobrança em aberto deixa de ser a cobrança certa (o valor
 * mudou com a troca de plano, o cartão passou no lugar do PIX, a assinatura foi
 * cancelada, outra cobrança do mês foi aprovada), ela precisa sair de
 * circulação no NOSSO banco e no Mercado Pago. Só o primeiro lado existia: a
 * linha virava CANCELADO e o copia-e-cola seguia pagável por 48 h — pago, ele
 * creditava o mês pelo valor antigo ou virava um segundo pagamento da mesma
 * competência, sem sinal para ninguém.
 *
 * As duas metades são separadas de propósito:
 *  - `baixarPendentes` roda DENTRO da transação de quem decidiu (regra 5): a
 *    troca de plano e a baixa das cobranças dela commitam juntas;
 *  - `cancelarNoGateway` roda DEPOIS do commit e é de melhor esforço. Chamada
 *    externa dentro de transação seguraria a linha travada pelo tempo da rede,
 *    e uma falha do gateway não pode desfazer a decisão local. O que não for
 *    cancelado lá é pego pela reconciliação diária (as CANCELADAS recentes são
 *    relidas, e a aprovada que aparecer não some em silêncio).
 */

export interface CobrancaBaixada {
  id: string;
  mpPaymentId: string | null;
  expiresAt: Date | null;
}

/**
 * Marca como CANCELADO as cobranças PENDENTES que casam com `where` e devolve
 * quais foram — para o chamador cancelá-las também no gateway depois do commit.
 */
export async function baixarPendentes(
  tx: Pick<Prisma.TransactionClient, "subscriptionPayment">,
  where: Prisma.SubscriptionPaymentWhereInput,
): Promise<CobrancaBaixada[]> {
  const alvo = await tx.subscriptionPayment.findMany({
    where: { ...where, status: "PENDENTE" },
    select: { id: true, mpPaymentId: true, expiresAt: true },
  });
  if (alvo.length === 0) return [];
  // `status: PENDENTE` de novo no filtro: entre a leitura e a escrita o webhook
  // pode ter aprovado uma delas, e aprovada não se cancela por aqui.
  await tx.subscriptionPayment.updateMany({
    where: { id: { in: alvo.map((c) => c.id) }, status: "PENDENTE" },
    data: { status: "CANCELADO", threeDsUrl: null },
  });
  return alvo;
}

/**
 * Cancela no Mercado Pago as cobranças já baixadas no banco. Nunca lança.
 *
 * Pula as que já expiraram (o gateway não aceita pagamento de PIX vencido, e
 * cancelar ali só geraria recusa no log) e as sem `mpPaymentId` (o gateway nem
 * chegou a criá-las).
 */
export async function cancelarNoGateway(
  cobrancas: CobrancaBaixada[],
  contexto: { tenantId: string; motivo: string },
  now: Date = new Date(),
): Promise<{ canceladas: number; falhas: number }> {
  const ids = [
    ...new Set(
      cobrancas
        .filter((c) => c.mpPaymentId && (!c.expiresAt || c.expiresAt > now))
        .map((c) => c.mpPaymentId as string),
    ),
  ];
  if (ids.length === 0 || !isMercadoPagoConfigured()) return { canceladas: 0, falhas: 0 };

  let canceladas = 0;
  let falhas = 0;
  for (const mpPaymentId of ids) {
    try {
      const r = await cancelPayment(mpPaymentId);
      if (r.status === "cancelled") {
        canceladas++;
      } else {
        // O gateway respondeu, mas com outro status — tipicamente `approved`:
        // o cliente pagou entre a nossa decisão e esta chamada. O webhook (ou a
        // reconciliação) trata a aprovação; aqui só fica o rastro.
        falhas++;
        logger.warn(
          { ...contexto, mpPaymentId, mpStatus: r.status },
          "Cobrança substituída não ficou cancelada no Mercado Pago",
        );
      }
    } catch (e) {
      falhas++;
      logger.warn(
        { ...contexto, mpPaymentId, err: describeError(e) },
        "Não foi possível cancelar a cobrança no Mercado Pago — ela pode seguir pagável até " +
          "expirar; a reconciliação diária acompanha",
      );
    }
  }
  if (canceladas > 0) {
    logger.info({ ...contexto, canceladas }, "Cobranças substituídas canceladas no Mercado Pago");
  }
  return { canceladas, falhas };
}
