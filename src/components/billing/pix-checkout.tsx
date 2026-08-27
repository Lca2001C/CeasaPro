"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { temPagamentoPix, type PixCharge } from "@/lib/payments/pix-charge";
import { PixChargePanel } from "./pix-charge-panel";

/**
 * Checkout PIX puro — usado quando o Payment Brick não está disponível
 * (`NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` ausente), já que o Brick exige a chave pública.
 */
export function PixCheckout({
  initialCharge,
  planId,
  onAwaitingPayment,
  onErro,
}: {
  initialCharge: PixCharge | null;
  /** Plano escolhido na tela. O servidor troca a assinatura antes de cobrar. */
  planId?: string;
  onAwaitingPayment: () => void;
  /** Motivo da recusa, para a tela mostrar de forma persistente. */
  onErro?: (mensagem: string | null) => void;
}) {
  const router = useRouter();
  const [charge, setCharge] = useState<PixCharge | null>(initialCharge);
  const [loading, setLoading] = useState(false);

  async function gerarPix() {
    setLoading(true);
    // O aceite dos termos é validado no servidor; a tela só chega aqui depois
    // que o usuário marcou a caixa (ou já havia aceitado a versão vigente).
    const res = await apiPost<PixCharge>("/api/billing/checkout", {
      method: "PIX",
      acceptedTerms: true,
      ...(planId ? { planId } : {}),
    });
    setLoading(false);
    if (!res.ok) {
      if (res.error.code === "MENSALIDADE_JA_PAGA") {
        toast.success("Sua mensalidade deste mês já está paga.");
        router.refresh();
        return;
      }
      toast.error(res.error.message);
      onErro?.(res.error.message);
      return;
    }
    onErro?.(null);
    if (!temPagamentoPix(res.data)) {
      toast.error("Não foi possível gerar o código PIX. Tente de novo em instantes.");
      return;
    }
    setCharge(res.data);
    onAwaitingPayment();
  }

  if (charge && temPagamentoPix(charge)) return <PixChargePanel charge={charge} />;

  return (
    <Button size="lg" className="w-full" onClick={gerarPix} disabled={loading}>
      {loading ? <Loader2 className="animate-spin" /> : <QrCode />} Gerar código PIX
    </Button>
  );
}
