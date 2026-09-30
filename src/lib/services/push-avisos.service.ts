import { prisma } from "@/lib/db/prisma";
import { AvisosService } from "./avisos.service";
import { planModules } from "@/lib/plan/modules";
import type { Prisma } from "@prisma/client";
import { accessDecision, computeStatus } from "@/lib/billing/status";
import { enviarPushParaUsuario, isPushConfigured } from "@/lib/pwa/push-server";
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

/** Ação gravada no lugar da marca quando a reserva não resultou em envio. */
const ACAO_FALHA = "PUSH_AVISO_FAILED";

/**
 * Reserva a marca de dedupe do dia: confere e grava NUMA transação serializada
 * por empresa, antes do envio. O lock usa o domínio 4 ("aviso diário por push")
 * no namespace da empresa (`hashtext(tenantId)`); o 1 é o de caixas plásticas,
 * o 3 o do lembrete de vencimento.
 *
 * Checar e gravar separados pelo envio era a janela de duas execuções
 * sobrepostas mandarem o mesmo aviso. O advisory lock é de TRANSAÇÃO (sobrevive
 * ao pgbouncer do Neon, como o de caixas): a segunda execução espera o commit da
 * primeira e, relendo, já encontra a marca. Devolve o id da marca, ou `null`
 * quando o aviso de hoje já foi (ou está sendo) enviado.
 */
async function reservarMarca(
  tenantId: string,
  janelaInicio: Date,
  newData: Record<string, unknown>,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 4)`;
    const ja = await tx.auditLog.findFirst({
      where: {
        tenantId,
        entity: "Tenant",
        entityId: tenantId,
        action: ACAO_AUDITORIA,
        createdAt: { gte: janelaInicio },
      },
      select: { id: true },
    });
    if (ja) return null;
    const marca = await tx.auditLog.create({
      data: {
        tenantId,
        action: ACAO_AUDITORIA,
        entity: "Tenant",
        entityId: tenantId,
        newData: newData as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return marca.id;
  });
}

/**
 * Desfaz a reserva quando nada saiu: a linha vira registro de FALHA (o dedupe
 * só procura a ação de sucesso), então o cron de amanhã tenta de novo e a
 * tentativa continua visível na auditoria.
 */
async function liberarMarca(id: string): Promise<void> {
  await prisma.auditLog.update({ where: { id }, data: { action: ACAO_FALHA } });
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
    //
    // O filtro de usuário VIVO não é detalhe: nem `desativarUsuario` nem
    // `deleteUser`/`deleteTenant` apagam a inscrição (o admin nunca toca em
    // `pushSubscription`), e a inscrição do navegador não é cancelada no
    // logout. Sem isto, quem perdeu o acesso continuava recebendo o aviso
    // diário da empresa todos os dias — com o movimento no corpo da
    // notificação ("3 cliente(s) com fiado vencido") — e o toque só levava à
    // tela de login. O bloqueio da EMPRESA já era checado dentro do laço; o do
    // usuário, não.
    //
    // Filtrar aqui também cura as linhas que a base já tem órfãs, o que uma
    // limpeza no momento da exclusão não alcançaria.
    const inscricoes = await prisma.pushSubscription.findMany({
      where: { user: { active: true, deletedAt: null } },
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
            subscription: {
              select: {
                status: true,
                statusSource: true,
                activatedAt: true,
                trialEndsAt: true,
                currentPeriodEnd: true,
                graceDays: true,
                cancelledAt: true,
                pendingPlanFrom: true,
                plan: { select: { features: true } },
                pendingPlan: { select: { features: true, active: true } },
              },
            },
          },
        });
        if (!tenant || tenant.deletedAt) {
          resultado.pulados += 1;
          continue;
        }
        // O status é RECALCULADO das datas, como no login (`buildAccessPayload`),
        // e não o gravado: o gravado só é atualizado pelo cron de billing, às
        // 13:30, e este roda às 06:30. Um teste que venceu às 20:00 de ontem
        // ainda estava TRIAL no banco, recebia o resumo do dia, e o toque caía
        // em /conta/suspensa — justo o que a regra 3 existe para evitar. O mesmo
        // valia para cancelamento com o mês pago vencendo de madrugada e para
        // VENCIDO que passou da tolerância.
        const sub = tenant.subscription;
        const statusEfetivo = sub ? computeStatus(sub, agora) : null;
        if (accessDecision(tenant.status, statusEfetivo) === "blocked") {
          resultado.pulados += 1;
          continue;
        }

        // Sem sessão aqui: os módulos vêm do plano da assinatura. Sem eles, a
        // notificação do dia podia ser "Higienização a pagar" para quem não
        // tem o módulo, e o toque caía no paywall. Troca de plano agendada que
        // já venceu vale: é o plano que o login vai aplicar no toque (o
        // `aplicarTrocaProgramada` descarta o agendamento de plano inativo, e
        // aqui o mesmo critério mantém o vigente). Só leitura — quem aplica é o
        // login ou o cron de billing, não o de avisos.
        const trocaVenceu =
          !!sub?.pendingPlan?.active && !!sub.pendingPlanFrom && sub.pendingPlanFrom <= agora;
        const features = trocaVenceu ? sub!.pendingPlan!.features : sub?.plan?.features;
        const avisos = await AvisosService.get(tenantId, planModules(features), agora);
        if (avisos.length === 0) {
          resultado.pulados += 1;
          continue;
        }

        const { title, body } = montarMensagem(avisos);

        // Reserva a marca ANTES de enviar. A checagem acima é só o atalho
        // barato; ela e a gravação ficavam separadas pelos segundos do envio, e
        // duas execuções sobrepostas (entrega dupla do cron, POST manual durante
        // a agendada) passavam as duas por ela — duas notificações, e com
        // `renotify` a segunda vibrava de novo.
        const marca = await reservarMarca(tenantId, janelaInicio, {
          avisos: avisos.length,
          title,
        });
        if (!marca) {
          resultado.pulados += 1;
          continue;
        }

        let algumEnviado = false;

        try {
          for (const userId of userIds) {
            const r = await enviarPushParaUsuario(userId, {
              title,
              body,
              url: avisos[0]!.href,
              // `tag` fixa: o aviso de hoje SUBSTITUI o de ontem na bandeja em
              // vez de empilhar uma pilha que ninguém lê.
              tag: "avisos-operacionais",
            });
            resultado.inscricoesRemovidas += r.removidos;
            if (r.enviados > 0) algumEnviado = true;
          }
        } catch (e) {
          // Exceção no meio do envio sem nada entregue: a reserva não pode
          // silenciar o aviso de amanhã.
          if (!algumEnviado) await liberarMarca(marca).catch(() => {});
          throw e;
        }

        // A marca do dedupe só FICA se algo saiu. Falha de rede no serviço de
        // push não pode silenciar o aviso de amanhã: a reserva vira registro de
        // falha, que o dedupe não procura.
        if (algumEnviado) {
          resultado.enviados += 1;
        } else {
          await liberarMarca(marca);
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
