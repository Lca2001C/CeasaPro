import { withTenantRoute } from "@/lib/http/with-route";
import { BillingService } from "@/lib/services/billing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status da cobrança do mês (para a tela de assinatura fazer polling e
 * detectar o pagamento aprovado sem o usuário recarregar).
 * allowInactive: acessível mesmo com a conta suspensa (é a tela de regularização).
 */
export const GET = withTenantRoute({
  allowInactive: true,
  handler: async (_input, ctx) => {
    const status = await BillingService.getStatus(ctx.tenantId);
    if (!status) {
      return {
        subStatus: null,
        refMonth: null,
        paidThisMonth: false,
        hasPendingCharge: false,
        chargeExpiresAt: null,
        chargeMethod: null,
        statusDetail: null,
        threeDsUrl: null,
      };
    }
    const pending = status.pendingCharge;
    return {
      subStatus: status.sub.status,
      refMonth: status.refMonth,
      paidThisMonth: Boolean(status.paidCharge),
      hasPendingCharge: Boolean(pending),
      chargeExpiresAt: pending?.expiresAt ?? null,
      chargeMethod: pending?.method ?? null,
      statusDetail: pending?.statusDetail ?? null,
      threeDsUrl: pending?.threeDsUrl ?? null,
    };
  },
});
