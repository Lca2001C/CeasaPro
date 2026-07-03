import { withTenantRoute } from "@/lib/http/with-route";
import { BillingService } from "@/lib/services/billing.service";

export const runtime = "nodejs";

export const POST = withTenantRoute({
  allowInactive: true, // permite pagar mesmo com assinatura vencida/suspensa
  handler: async (_input, ctx) => {
    const charge = await BillingService.createOrGetMonthlyCharge(ctx.tenantId);
    return {
      amount: charge.amount.toString(),
      qrCode: charge.qrCode,
      qrCodeBase64: charge.qrCodeBase64,
      ticketUrl: charge.ticketUrl,
      referenceMonth: charge.referenceMonth,
    };
  },
});
