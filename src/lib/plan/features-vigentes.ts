import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { planModules } from "./modules";

/**
 * Quais módulos a empresa tem AGORA — o único lugar que decide isso.
 *
 * Ler `plan.features` ao vivo era o que fazia a edição do catálogo atravessar o
 * mês já pago: o super-admin tirava um módulo do plano e quem tinha pago aquele
 * mês o perdia no refresh seguinte do token. A troca de plano pelo cliente já
 * esperava o fim do período (`pendingPlanId`); a edição do admin precisa
 * respeitar o mesmo período.
 *
 * Ordem, do mais específico ao mais geral:
 *  1. pagamento APROVADO que gravou os módulos que comprou e cobre `now`
 *     (`periodStart <= now < periodEnd`) — é o que aquele dinheiro comprou;
 *  2. `heldFeatures` enquanto `heldFeaturesUntil > now` — o congelamento que
 *     `AdminService.updatePlan` (e a virada da troca agendada) grava para o
 *     período pago por pagamento de antes destas colunas;
 *  3. período vencido (tolerância): interseção do que o último pagamento
 *     APROVADO comprou com `plan.features` do plano vigente;
 *  4. `plan.features` do plano vigente.
 *
 * Trial (`activatedAt` nulo) vai direto ao 4: não há período comprado a
 * proteger. Depois do vencimento nada segura módulo A MAIS: a interseção só
 * tira o que o plano novo não tem ou o que ainda não foi pago.
 *
 * Usado por `buildAccessPayload` (claim `modules`), `PlanoService.getPlanoView`
 * (tela de plano) e `push-avisos.service.ts` (avisos sem sessão). Uma quarta
 * leitura de `plan.features` para decidir acesso seria a brecha de volta.
 */
export interface AssinaturaParaModulos {
  id: string;
  activatedAt: Date | null;
  currentPeriodEnd: Date;
  heldFeatures: Prisma.JsonValue | null;
  heldFeaturesUntil: Date | null;
}

export async function featuresVigentes(
  sub: AssinaturaParaModulos,
  planFeatures: unknown,
  now = new Date(),
): Promise<unknown> {
  if (sub.activatedAt === null) return planFeatures;

  const pago = await prisma.subscriptionPayment.findFirst({
    where: {
      subscriptionId: sub.id,
      status: "APROVADO",
      features: { not: Prisma.DbNull },
      periodStart: { lte: now },
      periodEnd: { gt: now },
    },
    orderBy: { periodStart: "desc" },
    select: { features: true },
  });
  if (pago?.features != null) return pago.features;

  if (
    sub.heldFeaturesUntil !== null &&
    sub.heldFeaturesUntil > now &&
    sub.currentPeriodEnd > now &&
    sub.heldFeatures != null
  ) {
    return sub.heldFeatures;
  }

  // Vencido (tolerância): só o que o último período pago comprou E o plano de
  // agora tem. Sem isto, subir de plano em VENCIDO — inclusive ao gerar a
  // cobrança do plano caro em /assinatura — liberava os módulos antes de pagar,
  // e descer mantinha os caros até o fim da tolerância.
  if (sub.currentPeriodEnd <= now) {
    const ultimo = await prisma.subscriptionPayment.findFirst({
      where: {
        subscriptionId: sub.id,
        status: "APROVADO",
        features: { not: Prisma.DbNull },
        periodEnd: { lte: now },
      },
      orderBy: { periodEnd: "desc" },
      select: { features: true },
    });
    if (ultimo?.features != null) {
      const pagos = new Set(planModules(ultimo.features));
      return { modules: planModules(planFeatures).filter((m) => pagos.has(m)) };
    }
  }
  return planFeatures;
}

/** `featuresVigentes` já convertido na lista de módulos opcionais. */
export async function modulosVigentes(
  sub: AssinaturaParaModulos,
  planFeatures: unknown,
  now = new Date(),
) {
  return planModules(await featuresVigentes(sub, planFeatures, now));
}

/**
 * Cópia dos módulos de um plano para congelar (pagamento, hold, agendamento).
 *
 * Normaliza para `{ modules: [...] }` em vez de copiar o JSON cru: `Plan.features`
 * nulo viraria SQL NULL no snapshot, e NULL é "não há snapshot" — o resolvedor
 * cairia no plano vivo, que é justamente o que o congelamento existe para evitar.
 */
export function snapshotDeModulos(features: unknown): Prisma.InputJsonObject {
  return { modules: planModules(features) };
}
