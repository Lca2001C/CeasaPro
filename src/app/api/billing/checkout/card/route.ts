import { withTenantRoute } from "@/lib/http/with-route";
import { AppError, ForbiddenError } from "@/lib/http/app-error";
import { prisma } from "@/lib/db/prisma";
import { rateLimitDb } from "@/lib/security/rate-limit-db";
import { BillingService } from "@/lib/services/billing.service";
import { cardPaymentSchema } from "@/lib/validations/billing";

export const runtime = "nodejs";

/**
 * Tentativas de cartão por janela. O balcão paga uma vez por mês; recusa por
 * saldo e nova tentativa cabem com folga. O que estes tetos barram é o teste
 * de cartão roubado em laço: a public key do Mercado Pago é pública, e cada
 * recusa ou chargeback pesa na conta da PLATAFORMA — que, sinalizada, derruba a
 * cobrança de todos os clientes. O limite geral da rota (120/min, em memória,
 * por instância) não segurava isso.
 */
const POR_EMPRESA = { limit: 5, windowMs: 60 * 60 * 1000 };
const POR_IP = { limit: 10, windowMs: 60 * 60 * 1000 };

/**
 * Checkout com CARTÃO (crédito ou débito) via Payment Brick. Recebe o token do
 * browser (PCI-safe), nunca dados do cartão. `allowInactive` permite pagar com
 * a assinatura vencida. Quando o débito exige 3DS, devolve `threeDsUrl`.
 *
 * Exige o e-mail confirmado: o cadastro sem confirmação entra (empresa
 * SUSPENSA, `/assinatura` liberada) e, sem esta barreira, era a porta para
 * testar cartões com contas descartáveis. O PIX continua liberado.
 */
export const POST = withTenantRoute({
  schema: cardPaymentSchema,
  allowInactive: true,
  handler: async (input, ctx) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { emailVerifiedAt: true },
    });
    if (!user?.emailVerifiedAt) {
      throw new ForbiddenError(
        "Confirme seu e-mail para pagar com cartão. Enquanto isso, o PIX está liberado.",
      );
    }
    const [porEmpresa, porIp] = await Promise.all([
      rateLimitDb(`cartao:empresa:${ctx.tenantId}`, POR_EMPRESA),
      rateLimitDb(`cartao:ip:${ctx.ip ?? "desconhecido"}`, POR_IP),
    ]);
    if (!porEmpresa.ok || !porIp.ok) {
      throw new AppError(
        "RATE_LIMIT",
        "Muitas tentativas de pagamento com cartão. Aguarde uma hora ou pague com PIX.",
        429,
      );
    }
    return BillingService.processCardPayment(ctx.tenantId, input, ctx);
  },
});
