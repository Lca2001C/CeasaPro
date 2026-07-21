"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, Copy, QrCode, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost, apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface Charge {
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
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
  const [paid, setPaid] = useState(false);
  // Enquanto true, faz polling do status (QR PIX exibido ou cartão enviado/pendente).
  const [awaiting, setAwaiting] = useState(Boolean(initialCharge?.qrCodeBase64));
  const confirmed = useRef(false);

  const cardEnabled = Boolean(PUBLIC_KEY);

  // Inicializa o SDK do Mercado Pago no browser (uma vez).
  useEffect(() => {
    if (!cardEnabled) return;
    import("@mercadopago/sdk-react").then(({ initMercadoPago }) => {
      initMercadoPago(PUBLIC_KEY!, { locale: "pt-BR" });
    });
  }, [cardEnabled]);

  const confirmPaid = useCallback(async () => {
    if (confirmed.current) return;
    confirmed.current = true;
    setPaid(true);
    toast.success("Pagamento confirmado! Liberando o acesso...");
    await apiPost("/api/auth/refresh", {}); // renova o token com o novo status
    setTimeout(() => window.location.assign("/dashboard"), 1200);
  }, []);

  // Polling do status enquanto aguardando confirmação.
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

  async function gerarPix() {
    setLoading(true);
    const res = await apiPost<Charge>("/api/billing/checkout", {});
    setLoading(false);
    if (res.ok) {
      setCharge(res.data);
      setAwaiting(true);
    } else {
      toast.error(res.error.message);
    }
  }

  // Card Brick → envia o token ao backend. Retorna Promise (contrato do Brick).
  async function onCardSubmit(formData: {
    token: string;
    payment_method_id: string;
    installments: number;
  }) {
    const res = await apiPost<CardCheckout>("/api/billing/checkout/card", {
      token: formData.token,
      paymentMethodId: formData.payment_method_id,
      installments: 1,
    });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    if (res.data.status === "approved") {
      await confirmPaid();
    } else if (res.data.status === "rejected") {
      toast.error("Pagamento recusado. Tente outro cartão.");
    } else {
      // in_process / pending (ex.: 3DS/análise) — o webhook confirma; começa o polling.
      toast.info("Pagamento em análise. Aguarde a confirmação.");
      setAwaiting(true);
    }
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

  const pixPanel = charge?.qrCodeBase64 ? (
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
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Aguardando o pagamento — o acesso libera sozinho após a confirmação.
        </p>
      </CardContent>
    </Card>
  ) : (
    <Button size="lg" className="w-full" onClick={gerarPix} disabled={loading}>
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
