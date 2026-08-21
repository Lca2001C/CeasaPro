import { withTenantRoute } from "@/lib/http/with-route";
import { BillingService } from "@/lib/services/billing.service";
import { cardPaymentSchema } from "@/lib/validations/billing";

export const runtime = "nodejs";

/**
 * Checkout com CARTÃO (crédito ou débito) via Payment Brick. Recebe o token do
 * browser (PCI-safe), nunca dados do cartão. `allowInactive` permite pagar com
 * a assinatura vencida. Quando o débito exige 3DS, devolve `threeDsUrl`.
 */
export const POST = withTenantRoute({
  schema: cardPaymentSchema,
  allowInactive: true,
  handler: (input, ctx) => BillingService.processCardPayment(ctx.tenantId, input, ctx),
});
