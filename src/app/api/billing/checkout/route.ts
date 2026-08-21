import { withTenantRoute } from "@/lib/http/with-route";
import { BillingService } from "@/lib/services/billing.service";
import { checkoutSchema } from "@/lib/validations/billing";

export const runtime = "nodejs";

/** Cobrança PIX da mensalidade. `allowInactive`: é a tela de regularização. */
export const POST = withTenantRoute({
  schema: checkoutSchema,
  allowInactive: true,
  handler: async (input, ctx) => {
    const charge = await BillingService.createCheckout(ctx.tenantId, input, ctx);
    return {
      method: charge.method,
      amount: charge.amount.toString(),
      qrCode: charge.qrCode,
      qrCodeBase64: charge.qrCodeBase64,
      ticketUrl: charge.ticketUrl,
      referenceMonth: charge.referenceMonth,
      expiresAt: charge.expiresAt?.toISOString() ?? null,
    };
  },
});
