import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import type { PushSubscribeInput, PushUnsubscribeInput } from "@/lib/validations/push";

/**
 * Inscrições de Web Push por aparelho.
 *
 * A regra que justifica esta camada existir (em vez de ficar na rota) é a
 * identidade da inscrição: **o endpoint é o aparelho**, e é sobre ele que os dois
 * invariantes abaixo se apoiam. Ambos são regressões silenciosas — nada quebra,
 * o usuário só passa a receber errado — então ficam aqui, testáveis.
 */

/** Aparelhos com aviso ligado por pessoa — celular, computador, tablet, com folga. */
export const MAX_INSCRICOES_POR_USUARIO = 10;

export interface DonoInscricao {
  userId: string;
  tenantId: string;
}

export const PushInscricaoService = {
  /**
   * Registra (ou atualiza) a inscrição deste aparelho.
   *
   * `upsert` pelo `endpoint`, nunca `create`: o navegador devolve a MESMA
   * inscrição quando o usuário reabre o opt-in, e uma segunda linha faria a
   * pessoa receber cada notificação em duplicado.
   *
   * O upsert também **reatribui** `userId`/`tenantId`: num celular compartilhado,
   * a inscrição passa a pertencer a quem está logado agora — senão o aparelho
   * continuaria recebendo os avisos (e os números) do dono anterior, que é
   * vazamento entre empresas.
   */
  async registrar(
    dono: DonoInscricao,
    input: PushSubscribeInput,
    userAgent: string | null,
  ): Promise<{ ok: true }> {
    // A reatribuição exige as MESMAS chaves da inscrição: no celular
    // compartilhado o navegador manda a mesma inscrição (mesmas chaves) para a
    // conta nova. Quem só conhece o endereço (o `endpoint` de outro aparelho)
    // não tem as chaves — sem esta conferência, passava os avisos de outra
    // empresa para si. Recusa calada: nada muda e nada é revelado.
    const atual = await prisma.pushSubscription.findUnique({
      where: { endpoint: input.endpoint },
      select: { userId: true, p256dh: true, auth: true },
    });
    if (
      atual &&
      atual.userId !== dono.userId &&
      (atual.p256dh !== input.keys.p256dh || atual.auth !== input.keys.auth)
    ) {
      return { ok: true };
    }
    await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: dono.userId,
        tenantId: dono.tenantId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent,
      },
      update: {
        userId: dono.userId,
        tenantId: dono.tenantId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent,
      },
    });

    // Teto por pessoa: as mais antigas saem. Sem ele, um laço de inscrições
    // punha milhares de envios no cron diário, que é o mesmo para todas as
    // empresas — os avisos de todo mundo atrasavam junto.
    const excedentes = await prisma.pushSubscription.findMany({
      where: { userId: dono.userId },
      orderBy: { createdAt: "desc" },
      skip: MAX_INSCRICOES_POR_USUARIO,
      select: { id: true },
    });
    if (excedentes.length > 0) {
      await prisma.pushSubscription.deleteMany({
        where: { id: { in: excedentes.map((e) => e.id) } },
      });
    }

    // Endpoint fora do log: com as chaves, ele permite enviar notificação para
    // aquele aparelho.
    logger.info({ tenantId: dono.tenantId }, "Inscricao de push registrada");
    return { ok: true };
  },

  /**
   * Remove a inscrição deste aparelho.
   *
   * Filtra por `userId` junto com o endpoint: sem isso, conhecer um endpoint
   * alheio permitiria desligar os avisos de outra pessoa.
   */
  async remover(
    dono: Pick<DonoInscricao, "userId">,
    input: PushUnsubscribeInput,
  ): Promise<{ removidas: number }> {
    const { count } = await prisma.pushSubscription.deleteMany({
      where: { endpoint: input.endpoint, userId: dono.userId },
    });
    return { removidas: count };
  },
};
