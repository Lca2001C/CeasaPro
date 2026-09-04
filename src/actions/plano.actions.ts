"use server";

import { withTenantAction } from "@/lib/http/with-action";
import { PlanoService } from "@/lib/services/plano.service";
import { BillingService } from "@/lib/services/billing.service";
import { z } from "zod";

/** Troca o plano da empresa (OWNER). Módulo-núcleo: sem gate de módulo. */
export const trocarPlano = withTenantAction({
  schema: z.object({ planId: z.string().min(1) }),
  handler: (input, ctx) => PlanoService.changePlan(input.planId, ctx),
});

/** Cancela a assinatura (OWNER). Sem multa; o mês pago segue até o vencimento. */
export const cancelarAssinatura = withTenantAction({
  handler: (_input: unknown, ctx) => BillingService.cancelarAssinatura(ctx),
});

/** Desfaz o cancelamento enquanto o período pago ainda vale. */
export const reativarAssinatura = withTenantAction({
  handler: (_input: unknown, ctx) => BillingService.reativarAssinatura(ctx),
});
