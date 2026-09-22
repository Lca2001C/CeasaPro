"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { PlanoService } from "@/lib/services/plano.service";
import { BillingService } from "@/lib/services/billing.service";
import { z } from "zod";

/**
 * Troca o plano da empresa (OWNER). Módulo-núcleo: sem gate de módulo.
 *
 * O resultado diz se a troca valeu na hora ou foi AGENDADA para a competência
 * seguinte — com o mês corrente já pago, trocar na hora entregaria o plano caro
 * ao preço do barato. Quem decide é o serviço; a action continua sem regra.
 */
export const trocarPlano = withTenantAction({
  schema: z.object({ planId: z.string().min(1) }),
  handler: (input, ctx) => PlanoService.changePlan(input.planId, ctx),
});

/** Desfaz uma troca de plano agendada (OWNER). */
export const cancelarTrocaDePlano = withTenantAction({
  handler: (_input: unknown, ctx) => PlanoService.cancelarTrocaProgramada(ctx),
});

/** Cancela a assinatura (OWNER). Sem multa; o mês pago segue até o vencimento. */
export const cancelarAssinatura = withTenantAction({
  handler: (_input: unknown, ctx) => BillingService.cancelarAssinatura(ctx),
});

/** Desfaz o cancelamento enquanto o período pago ainda vale. */
export const reativarAssinatura = withTenantAction({
  handler: (_input: unknown, ctx) => BillingService.reativarAssinatura(ctx),
});
