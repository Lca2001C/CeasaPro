"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, Copy, QrCode, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost, apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export interface Charge {
  method: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  preferenceId?: string | null;
  amount: string;
}

interface BillingStatus {
  subStatus: string | null;
  paidThisMonth: boolean;
  hasPendingCharge: boolean;
}

interface CardCheckout {
  status: string;
  mpPaymentId: string;
}

const POLL_MS = 5000;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;

// Card Brick é client-only (acessa window) — carregado dinamicamente sem SSR.
const CardPayment = dynamic(
  () => import("@mercadopago/sdk-react").then((m) => m.CardPayment),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

export function AssinaturaClient({
  mpConfigured,
  monthlyAmount,
  initialCharge,
}: {
  mpConfigured: boolean;
  monthlyAmount: number;
  initialCharge: Charge | null;
}) {
  const [charge, setCharge] = useState<Charge | null>(initialCharge);
  const [loading, setLoading] = useState(false);

  async function gerar() {
    setLoading(true);
    const res = await apiPost<Charge>("/api/billing/checkout", {});
    setLoading(false);
    if (res.ok) setCharge(res.data);
    else toast.error(res.error.message);
  }

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

  if (charge?.qrCodeBase64) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <p className="font-medium">Pague com PIX para ativar/renovar</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${charge.qrCodeBase64}`}
            alt="QR Code PIX"
            className="size-56 rounded-lg border"
          />
          {charge.qrCode && (
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(charge.qrCode!);
                toast.success("Código PIX copiado");
              }}
            >
              <Copy /> Copiar código PIX
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Após o pagamento, o acesso é liberado automaticamente em alguns instantes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Button size="lg" className="w-full" onClick={gerar} disabled={loading}>
      {loading ? <Loader2 className="animate-spin" /> : <QrCode />} Gerar cobrança PIX
    </Button>
  );

  // Sem cartão configurado: mantém só o fluxo PIX (sem abas).
  if (!cardEnabled) return pixPanel;

  return (
    <Tabs defaultValue="pix">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="pix">PIX</TabsTrigger>
        <TabsTrigger value="card">Cartão</TabsTrigger>
      </TabsList>
      <TabsContent value="pix">{pixPanel}</TabsContent>
      <TabsContent value="card">
        <Card>
          <CardContent className="pt-6">
            <CardPayment
              initialization={{ amount: monthlyAmount }}
              customization={{
                paymentMethods: { maxInstallments: 1, minInstallments: 1 },
              }}
              onSubmit={onCardSubmit}
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
