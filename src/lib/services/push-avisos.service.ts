import { prisma } from "@/lib/db/prisma";
import { AvisosService } from "./avisos.service";
import { accessDecision } from "@/lib/billing/status";
import { enviarPushParaUsuario, isPushConfigured } from "@/lib/pwa/push-server";
import { audit } from "@/lib/audit";
import { describeError, logger } from "@/lib/logger";

/**
 * Avisos operacionais por notificação (fiado vencido, despesa a vencer,
 * higienização a pagar).
 *
 * Hoje esses avisos só aparecem se a pessoa abrir o app — e quem está no balcão
 * não abre para conferir se tem algo vencendo. É esse o buraco que o push fecha.
 *
 * Três regras de produto sustentam o desenho, e nenhuma é detalhe técnico:
 *
 * 1. **UMA notificação por empresa por dia, não uma por aviso.** Três
 *    notificações simultâneas sobre a mesma operação treinam o usuário a
 *    descartar sem ler — e aí ele perde a que importava. O resumo entra no corpo.
 * 2. **Dedupe pelo log de auditoria**, na mesma linha do que
 *    `enviarLembretesDeVencimento` já faz. O cron pode ser reexecutado (retry da
 *    plataforma, disparo manual) e mandar o mesmo aviso duas vezes é o jeito mais
 *    rápido de perder a confiança do usuário na notificação.
 * 3. **Empresa com acesso bloqueado não recebe.** Avisar "você tem fiado vencido"
 *    quem não consegue nem abrir a tela de fiado é ruído com dano: a pessoa toca
 *    na notificação e cai no bloqueio de assinatura.
 */

const ACAO_AUDITORIA = "PUSH_AVISO_SENT";

/**
 * Janela do dedupe.
 *
 * 20 horas, não 24: o cron roda diariamente e um atraso na plataforma faria a
 * execução do dia seguinte cair dentro de uma janela de 24h, silenciando o aviso
 * daquele dia. 20h cobre o retry e ainda permite o envio diário.
 */
const JANELA_DEDUPE_MS = 20 * 60 * 60 * 1000;

export interface ResultadoAvisos {
  candidatos: number;
  enviados: number;
  pulados: number;
  inscricoesRemovidas: number;
}

/** Monta título e corpo a partir dos avisos da empresa. */
function montarMensagem(avisos: { label: string }[]): { title: string; body: string } {
  if (avisos.length === 1) {
    return { title: "CeasaPro", body: avisos[0]!.label };
  }
  return {
    title: `CeasaPro — ${avisos.length} avisos`,
    // Os dois primeiros no corpo; a tela mostra o resto. Notificação longa é
    // truncada pelo sistema de qualquer forma.
    body: avisos.slice(0, 2).map((a) => a.label).join(" · ") +
      (avisos.length > 2 ? ` · e mais ${avisos.length - 2}` : ""),
  };
}

export const PushAvisosService = {
  /**
   * Percorre as empresas COM inscrição de push e envia o resumo do dia.
   *
   * Só considera empresas que têm alguém inscrito: varrer a base inteira para
   * calcular avisos que ninguém receberia seria custo puro.
   */
  async enviarAvisosDiarios(agora: Date = new Date()): Promise<ResultadoAvisos> {
    const resultado: ResultadoAvisos = {
      candidatos: 0,
      enviados: 0,
      pulados: 0,
      inscricoesRemovidas: 0,
    };

    if (!isPushConfigured()) {
      logger.info("Push nao configurado (VAPID ausente) — cron de avisos sem efeito");
      return resultado;
    }

    // Um usuário por inscrição; agrupa por tenant para calcular os avisos uma vez.
    const inscricoes = await prisma.pushSubscription.findMany({
      distinct: ["userId"],
      select: { userId: true, tenantId: true },
    });
    if (inscricoes.length === 0) return resultado;

    const porTenant = new Map<string, string[]>();
    for (const i of inscricoes) {
      const lista = porTenant.get(i.tenantId) ?? [];
      lista.push(i.userId);
      porTenant.set(i.tenantId, lista);
    }
    resultado.candidatos = porTenant.size;

    const janelaInicio = new Date(agora.getTime() - JANELA_DEDUPE_MS);

    for (const [tenantId, userIds] of porTenant) {
      try {
        const jaAvisado = await prisma.auditLog.findFirst({
          where: {
            tenantId,
            entity: "Tenant",
            entityId: tenantId,
            action: ACAO_AUDITORIA,
            createdAt: { gte: janelaInicio },
          },
          select: { id: true },
        });
        if (jaAvisado) {
          resultado.pulados += 1;
          continue;
        }

        // Acesso bloqueado: a notificação levaria a pessoa para a tela de
        // suspensão, não para o aviso.
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            status: true,
            deletedAt: true,
            subscription: { select: { status: true } },
          },
        });
        if (!tenant || tenant.deletedAt) {
          resultado.pulados += 1;
          continue;
        }
        if (accessDecision(tenant.status, tenant.subscription?.status) === "blocked") {
          resultado.pulados += 1;
          continue;
        }

        const avisos = await AvisosService.get(tenantId);
        if (avisos.length === 0) {
          resultado.pulados += 1;
          continue;
        }

        const { title, body } = montarMensagem(avisos);
        let algumEnviado = false;

        for (const userId of userIds) {
          const r = await enviarPushParaUsuario(userId, {
            title,
            body,
            url: avisos[0]!.href,
            // `tag` fixa: o aviso de hoje SUBSTITUI o de ontem na bandeja em vez
            // de empilhar uma pilha que ninguém lê.
            tag: "avisos-operacionais",
          });
          resultado.inscricoesRemovidas += r.removidos;
          if (r.enviados > 0) algumEnviado = true;
        }

        // A marca do dedupe só é gravada se ALGO saiu. Falha de rede no serviço de
        // push não pode silenciar o aviso de amanhã.
        if (algumEnviado) {
          await audit({
            tenantId,
            action: ACAO_AUDITORIA,
            entity: "Tenant",
            entityId: tenantId,
            newData: { avisos: avisos.length, title },
          });
          resultado.enviados += 1;
        } else {
          resultado.pulados += 1;
        }
      } catch (e) {
        // Uma empresa com problema não pode parar as outras.
        resultado.pulados += 1;
        logger.error({ err: describeError(e), tenantId }, "Falha ao enviar avisos por push");
      }
    }

    return resultado;
  },
};
