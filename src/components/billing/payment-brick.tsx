"use client";

import { useEffect, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Payment as PaymentBrickComponent } from "@mercadopago/sdk-react";
import { apiPost } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import type { CardPaymentResult } from "@/lib/validations/billing";
import { PixChargePanel, type PixCharge } from "./pix-charge-panel";
import { ThreeDsChallenge } from "./three-ds-challenge";

const brickLoader = (
  <div className="flex justify-center py-8">
    <Loader2 className="size-6 animate-spin text-muted-foreground" />
  </div>
);

// O Brick acessa `window` — carregado dinamicamente, sem SSR.
const Payment = dynamic(() => import("@mercadopago/sdk-react").then((m) => m.Payment), {
  ssr: false,
  loading: () => brickLoader,
});

/** Dados que o Brick entrega no submit (tipo derivado do próprio SDK). */
type PaymentFormData = Parameters<
  ComponentProps<typeof PaymentBrickComponent>["onSubmit"]
>[0];

interface ThreeDs {
  url: string;
  creq: string | null;
}

/** Mensagem amigável para as recusas mais comuns do Mercado Pago. */
const REJECTION_MESSAGES: Record<string, string> = {
  cc_rejected_insufficient_amount: "Cartão sem limite disponível. Tente outro cartão.",
  cc_rejected_bad_filled_security_code: "Código de segurança inválido.",
  cc_rejected_bad_filled_date: "Data de validade inválida.",
  cc_rejected_bad_filled_other: "Dados do cartão incorretos. Confira e tente de novo.",
  cc_rejected_call_for_authorize: "Autorize a compra com o seu banco e tente de novo.",
  cc_rejected_high_risk: "Pagamento recusado por segurança. Tente outro meio de pagamento.",
};

function rejectionMessage(statusDetail: string | null): string {
  return (
    (statusDetail && REJECTION_MESSAGES[statusDetail]) ??
    "Pagamento recusado. Tente outro cartão ou pague com PIX."
  );
}

/**
 * Payment Brick unificado: PIX, cartão de crédito e cartão de débito (com 3DS).
 * O componente só orquestra o checkout — a confirmação do pagamento é do
 * componente pai, que faz o polling em `/api/billing/status`.
 */
export function PaymentBrick({
  publicKey,
  amount,
  payerEmail,
  initialCharge,
  onPaid,
  onAwaitingPayment,
}: {
  publicKey: string;
  amount: number;
  payerEmail?: string;
  initialCharge: PixCharge | null;
  onPaid: () => void | Promise<void>;
  onAwaitingPayment: () => void;
}) {
  const [charge, setCharge] = useState<PixCharge | null>(initialCharge);
  const [threeDs, setThreeDs] = useState<ThreeDs | null>(null);

  useEffect(() => {
    void import("@mercadopago/sdk-react").then(({ initMercadoPago }) => {
      initMercadoPago(publicKey, { locale: "pt-BR" });
    });
  }, [publicKey]);

  async function submitPix() {
    // O aceite dos termos é validado no servidor; o Brick só é montado depois
    // que o usuário marcou a caixa (ou já havia aceitado a versão vigente).
    const res = await apiPost<PixCharge>("/api/billing/checkout", {
      method: "PIX",
      acceptedTerms: true,
    });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setCharge(res.data);
    onAwaitingPayment();
  }

  async function submitCard(data: PaymentFormData, method: "CREDIT_CARD" | "DEBIT_CARD") {
    const { formData } = data;
    const identification = formData.payer?.identification;
    const res = await apiPost<CardPaymentResult>("/api/billing/checkout/card", {
      method,
      token: formData.token,
      paymentMethodId: formData.payment_method_id,
      issuerId: formData.issuer_id || undefined,
      installments: method === "DEBIT_CARD" ? 1 : (formData.installments ?? 1),
      payer: {
        email: formData.payer?.email ?? payerEmail,
        identification: identification?.number ? identification : undefined,
      },
      acceptedTerms: true,
    });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }

    if (res.data.threeDsUrl) {
      setThreeDs({ url: res.data.threeDsUrl, creq: res.data.threeDsCreq });
      onAwaitingPayment();
      return;
    }
    if (res.data.status === "APROVADO") {
      await onPaid();
      return;
    }
    if (res.data.status === "RECUSADO") {
      toast.error(rejectionMessage(res.data.statusDetail));
      return;
    }
    // Em análise: o webhook confirma e o polling do pai libera o acesso.
    toast.info("Pagamento em análise. Aguarde a confirmação.");
    onAwaitingPayment();
  }

  async function onSubmit(data: PaymentFormData) {
    switch (data.selectedPaymentMethod) {
      case "bank_transfer":
        return submitPix();
      case "creditCard":
        return submitCard(data, "CREDIT_CARD");
      case "debitCard":
        return submitCard(data, "DEBIT_CARD");
      default:
        toast.error("Forma de pagamento não disponível para a mensalidade.");
    }
  }

  if (threeDs) return <ThreeDsChallenge url={threeDs.url} creq={threeDs.creq ?? undefined} />;
  if (charge?.qrCodeBase64) return <PixChargePanel charge={charge} />;

  return (
    <Card>
      <CardContent className="pt-6">
        <Payment
          initialization={{
            amount,
            ...(payerEmail ? { payer: { email: payerEmail } } : {}),
          }}
          customization={{
            paymentMethods: {
              creditCard: "all",
              debitCard: "all",
              bankTransfer: "all",
              // Mensalidade é sempre à vista.
              minInstallments: 1,
              maxInstallments: 1,
            },
          }}
          onSubmit={onSubmit}
        />
      </CardContent>
    </Card>
  );
}
