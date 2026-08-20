"use client";

import { useState } from "react";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PixChargePanel, type PixCharge } from "./pix-charge-panel";

/**
 * Checkout PIX puro — usado quando o Payment Brick não está disponível
 * (`NEXT_PUBLIC_MP_PUBLIC_KEY` ausente), já que o Brick exige a chave pública.
 */
export function PixCheckout({
  initialCharge,
  onAwaitingPayment,
}: {
  initialCharge: PixCharge | null;
  onAwaitingPayment: () => void;
}) {
  const [charge, setCharge] = useState<PixCharge | null>(initialCharge);
  const [loading, setLoading] = useState(false);

  async function gerarPix() {
    setLoading(true);
    const res = await apiPost<PixCharge>("/api/billing/checkout", { method: "PIX" });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setCharge(res.data);
    onAwaitingPayment();
  }

  if (charge?.qrCodeBase64) return <PixChargePanel charge={charge} />;

  return (
    <Button size="lg" className="w-full" onClick={gerarPix} disabled={loading}>
      {loading ? <Loader2 className="animate-spin" /> : <QrCode />} Gerar cobrança PIX
    </Button>
  );
}
