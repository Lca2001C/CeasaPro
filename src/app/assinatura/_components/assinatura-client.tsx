"use client";

import { useState } from "react";
import { Loader2, Copy, QrCode } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Charge {
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  amount: string;
}

export function AssinaturaClient({
  mpConfigured,
  initialCharge,
}: {
  mpConfigured: boolean;
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
          Assim que o token for configurado, o PIX aparecerá aqui automaticamente.
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
}
