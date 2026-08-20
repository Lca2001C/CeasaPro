"use client";

import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface PixCharge {
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  amount: string;
}

/** QR Code da cobrança PIX do mês, com copia-e-cola. */
export function PixChargePanel({ charge }: { charge: PixCharge }) {
  const qrCode = charge.qrCode;
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
        <p className="font-medium">Pague com PIX para ativar/renovar</p>
        {charge.qrCodeBase64 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${charge.qrCodeBase64}`}
            alt="QR Code PIX"
            className="size-56 rounded-lg border"
          />
        )}
        {qrCode && (
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(qrCode);
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
  );
}
