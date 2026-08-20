import { z } from "zod";
import { withTenantRoute } from "@/lib/http/with-route";
import { BillingService } from "@/lib/services/billing.service";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  method: z.enum(["pix", "card"]).default("pix"),
});

export const POST = withTenantRoute({
  schema: checkoutSchema,
  allowInactive: true, // permite pagar mesmo com assinatura vencida/suspensa
  handler: async (input, ctx) => {
    const charge = await BillingService.createOrGetMonthlyCharge(ctx.tenantId, input.method);
    return {
      method: charge.method,
      amount: charge.amount.toString(),
      qrCode: charge.qrCode,
      qrCodeBase64: charge.qrCodeBase64,
      ticketUrl: charge.ticketUrl,
      preferenceId: charge.mpPreferenceId,
      referenceMonth: charge.referenceMonth,
      expiresAt: charge.expiresAt?.toISOString() ?? null,
    };
  },
});
