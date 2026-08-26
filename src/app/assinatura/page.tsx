import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { BillingService } from "@/lib/services/billing.service";
import { PlanoService } from "@/lib/services/plano.service";
import { formatBRL, formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { TERMS_VERSION } from "@/lib/legal";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { AssinaturaClient } from "./_components/assinatura-client";

export const dynamic = "force-dynamic";

export default async function AssinaturaPage() {
  const { session, tenantId } = await requireTenant();
  const [status, plans] = await Promise.all([
    BillingService.getStatus(tenantId),
    PlanoService.listAvailablePlans(tenantId),
  ]);
  const sub = status?.sub;
  const charge = status?.pendingCharge ?? null;

  // Empresa que nunca pagou tem `currentPeriodEnd` no passado: mostrar "vence
  // <data antiga>" só confundiria. O convite é para a primeira ativação.
  const primeiraAtivacao = Boolean(sub && !sub.activatedAt);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary">Assinatura</h1>
        {sub && (
          <p className="mt-1 text-sm text-muted-foreground">
            {primeiraAtivacao ? (
              // Sem valor no cabeçalho: na primeira contratação o preço é o do
              // plano que a pessoa ainda vai escolher logo abaixo, e repetir o
              // valor do plano pré-selecionado aqui contradiria a escolha dela.
              <>Escolha o plano e a forma de pagamento para ativar o acesso</>
            ) : (
              <>
                {SUBSCRIPTION_STATUS_LABELS[sub.status]} · {formatBRL(sub.monthlyAmount)}/mês ·
                vence {formatDate(sub.currentPeriodEnd)}
              </>
            )}
          </p>
        )}
        {primeiraAtivacao && (
          <p className="mt-2 text-sm text-muted-foreground">
            O acesso ao sistema é liberado automaticamente assim que o pagamento for aprovado.
          </p>
        )}
      </div>

      <AssinaturaClient
        mpConfigured={BillingService.mpConfigured()}
        monthlyAmount={sub ? Number(sub.monthlyAmount) : 0}
        payerEmail={session.email || undefined}
        termsAccepted={sub?.tenant.termsVersion === TERMS_VERSION}
        plans={plans}
        primeiraAtivacao={primeiraAtivacao}
        // Reabre a cobrança pendente com qualquer forma de pagar: só o
        // copia-e-cola já basta para o cliente concluir no app do banco.
        initialCharge={
          charge && (charge.qrCode || charge.qrCodeBase64 || charge.ticketUrl)
            ? {
                qrCode: charge.qrCode,
                qrCodeBase64: charge.qrCodeBase64,
                ticketUrl: charge.ticketUrl,
                amount: charge.amount.toString(),
                expiresAt: charge.expiresAt?.toISOString() ?? null,
              }
            : null
        }
      />

      <div className="flex justify-between">
        <Button asChild variant="ghost">
          <Link href="/dashboard">Voltar ao sistema</Link>
        </Button>
        <LogoutButton />
      </div>
    </div>
  );
}
