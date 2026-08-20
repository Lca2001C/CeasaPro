"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { PaymentBrick } from "@/components/billing/payment-brick";
import { PixCheckout } from "@/components/billing/pix-checkout";
import type { PixCharge } from "@/components/billing/pix-charge-panel";

interface BillingStatus {
  subStatus: string | null;
  paidThisMonth: boolean;
  hasPendingCharge: boolean;
}

const POLL_MS = 5000;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;

/**
 * Tela de pagamento da mensalidade. Escolhe entre o Payment Brick (PIX, crédito
 * e débito) e o fallback PIX-only, e confirma o pagamento por polling — o
 * webhook do Mercado Pago é quem realmente aprova a cobrança.
 */
export function AssinaturaClient({
  mpConfigured,
  monthlyAmount,
  payerEmail,
  initialCharge,
}: {
  mpConfigured: boolean;
  monthlyAmount: number;
  payerEmail?: string;
  initialCharge: PixCharge | null;
}) {
  const [paid, setPaid] = useState(false);
  const [awaiting, setAwaiting] = useState(Boolean(initialCharge?.qrCodeBase64));
  const confirmed = useRef(false);

  const confirmPaid = useCallback(async () => {
    if (confirmed.current) return;
    confirmed.current = true;
    setPaid(true);
    toast.success("Pagamento confirmado! Liberando o acesso...");
    await apiPost("/api/auth/refresh", {}); // renova o token com o novo status
    setTimeout(() => window.location.assign("/dashboard"), 1200);
  }, []);

  const startAwaiting = useCallback(() => setAwaiting(true), []);

  useEffect(() => {
    if (!awaiting || paid) return;
    const timer = setInterval(async () => {
      const res = await apiGet<BillingStatus>("/api/billing/status");
      if (res.ok && res.data.paidThisMonth && !confirmed.current) {
        clearInterval(timer);
        void confirmPaid();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [awaiting, paid, confirmPaid]);

  if (!mpConfigured) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          O pagamento online (Mercado Pago) ainda não está configurado nesta instalação.
          Assim que o token for configurado, o pagamento aparecerá aqui automaticamente.
        </CardContent>
      </Card>
    );
  }

  if (paid) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <CheckCircle2 className="size-12 text-success" />
          <p className="font-medium">Pagamento confirmado!</p>
          <p className="text-sm text-muted-foreground">Liberando o seu acesso...</p>
        </CardContent>
      </Card>
    );
  }

  if (!PUBLIC_KEY) {
    return <PixCheckout initialCharge={initialCharge} onAwaitingPayment={startAwaiting} />;
  }

  return (
    <PaymentBrick
      publicKey={PUBLIC_KEY}
      amount={monthlyAmount}
      payerEmail={payerEmail}
      initialCharge={initialCharge}
      onPaid={confirmPaid}
      onAwaitingPayment={startAwaiting}
    />
  );
}
