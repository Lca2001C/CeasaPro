import { z } from "zod";
import { withTenantRoute } from "@/lib/http/with-route";
import { BillingService } from "@/lib/services/billing.service";

export const runtime = "nodejs";

const schema = z.object({
  token: z.string().min(1),
  paymentMethodId: z.string().min(1),
  installments: z.number().int().positive().default(1),
});

/**
 * Checkout com CARTÃO (Card Brick). Recebe o token do browser (PCI-safe),
 * nunca dados do cartão. `allowInactive` permite pagar com assinatura vencida.
 */
export const POST = withTenantRoute({
  schema,
  allowInactive: true,
  handler: async (input, ctx) => {
    const charge = await BillingService.createOrGetMonthlyCharge(ctx.tenantId, "card", {
      token: input.token,
      paymentMethodId: input.paymentMethodId,
      installments: input.installments,
    });
    return {
      status: charge.status,
      mpPaymentId: charge.mpPaymentId,
      referenceMonth: charge.referenceMonth,
    };
  },
});
