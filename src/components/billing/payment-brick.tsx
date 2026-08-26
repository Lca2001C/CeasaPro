"use client";

import { useEffect, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import type { Payment as PaymentBrickComponent } from "@mercadopago/sdk-react";
import { apiPost } from "@/lib/api-client";
import { normalizarMetodoBrick } from "@/lib/payments/brick-method";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CardPaymentResult } from "@/lib/validations/billing";
import { temPagamentoPix, type PixCharge } from "@/lib/payments/pix-charge";
import { PixChargePanel } from "./pix-charge-panel";
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
  cc_rejected_bad_filled_card_number: "Número do cartão incorreto.",
  cc_rejected_call_for_authorize: "Ligue para o seu banco e autorize esta compra, depois tente de novo.",
  cc_rejected_high_risk: "Pagamento recusado por segurança. Tente outro meio de pagamento.",
  cc_rejected_card_disabled: "Cartão não habilitado para compras online. Peça a liberação ao banco.",
  cc_rejected_card_type_not_allowed: "Este tipo de cartão não é aceito. Tente outro ou pague com PIX.",
  cc_rejected_duplicated_payment: "Já existe um pagamento igual em andamento. Aguarde alguns minutos.",
  cc_rejected_max_attempts: "Muitas tentativas com este cartão. Tente outro ou pague com PIX.",
  cc_rejected_invalid_installments: "Parcelamento não aceito por este cartão.",
  cc_rejected_blacklist: "Pagamento recusado pelo emissor. Tente outro cartão ou pague com PIX.",
  cc_rejected_other_reason: "O banco emissor recusou a compra. Tente outro cartão ou pague com PIX.",
};

function rejectionMessage(statusDetail: string | null): string {
  if (statusDetail && REJECTION_MESSAGES[statusDetail]) {
    return REJECTION_MESSAGES[statusDetail];
  }
  // Recusa que ainda não traduzimos: mostra o código do Mercado Pago. É feio,
  // mas é o que permite descobrir o motivo sem acesso ao log do servidor —
  // "Pagamento recusado" sozinho não dá para investigar.
  return statusDetail
    ? `Pagamento recusado pelo emissor (${statusDetail}). Tente outro cartão ou pague com PIX.`
    : "Pagamento recusado. Tente outro cartão ou pague com PIX.";
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
  planId,
  onPaid,
  onAwaitingPayment,
}: {
  publicKey: string;
  amount: number;
  payerEmail?: string;
  initialCharge: PixCharge | null;
  /** Plano escolhido na tela. O servidor troca a assinatura antes de cobrar. */
  planId?: string;
  onPaid: () => void | Promise<void>;
  onAwaitingPayment: () => void;
}) {
  const [charge, setCharge] = useState<PixCharge | null>(initialCharge);
  const [threeDs, setThreeDs] = useState<ThreeDs | null>(null);
  const [gerandoPix, setGerandoPix] = useState(false);

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
      ...(planId ? { planId } : {}),
    });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    if (!temPagamentoPix(res.data)) {
      // Cobrança criada sem QR nem copia-e-cola: não há como pagar. Avisa em
      // vez de deixar o cliente na tela do Brick, que manda procurar o código
      // no e-mail — e-mail que este fluxo não envia.
      toast.error("Não foi possível gerar o código PIX. Tente de novo ou use cartão.");
      return;
    }
    setCharge(res.data);
    onAwaitingPayment();
  }

  /** Botão próprio do PIX — este caminho não passa pelo Brick. */
  async function gerarPix() {
    setGerandoPix(true);
    try {
      await submitPix();
    } finally {
      setGerandoPix(false);
    }
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
        // `||`, não `??`: o Brick devolve string VAZIA quando o campo de e-mail
        // vem pré-preenchido e oculto. Com `??` o vazio passava adiante e o
        // servidor recusava com "Dados inválidos", sem dizer qual campo.
        email: formData.payer?.email || payerEmail,
        identification: identification?.number ? identification : undefined,
      },
      acceptedTerms: true,
      ...(planId ? { planId } : {}),
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
    const metodo = normalizarMetodoBrick(data.selectedPaymentMethod, data.paymentType);
    if (metodo === "PIX") return submitPix();
    if (metodo === "CREDIT_CARD") return submitCard(data, "CREDIT_CARD");
    if (metodo === "DEBIT_CARD") return submitCard(data, "DEBIT_CARD");
    // Inclui o identificador na mensagem: se o Brick passar a emitir um valor
    // novo, dá para descobrir qual sem precisar depurar o iframe.
    toast.error(
      `Forma de pagamento não disponível para a mensalidade (${String(data.selectedPaymentMethod)}).`,
    );
  }

  if (threeDs) return <ThreeDsChallenge url={threeDs.url} creq={threeDs.creq ?? undefined} />;
  // Basta ter QR, copia-e-cola OU link: exigir a imagem base64 fazia o painel
  // não aparecer quando o Mercado Pago mandava só o copia-e-cola, e o cliente
  // ficava preso na tela do Brick.
  if (charge && temPagamentoPix(charge)) return <PixChargePanel charge={charge} />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="pt-6">
          <Payment
            // O Brick lê `initialization` só na montagem: trocar de plano mudaria
            // o valor no nosso estado e o iframe seguiria cobrando o anterior.
            // A `key` força a remontagem quando o valor muda.
            key={amount}
            initialization={{
              amount,
              ...(payerEmail ? { payer: { email: payerEmail } } : {}),
            }}
            customization={{
              paymentMethods: {
                creditCard: "all",
                debitCard: "all",
                // PIX (`bankTransfer`) fica FORA do Brick de propósito: o passo
                // de seleção dele é do Mercado Pago e diz "insira o e-mail para
                // receber o código Pix" — promessa que este fluxo não cumpre,
                // porque o código aparece na própria tela. Aquele texto roda
                // dentro do iframe e não há como reescrevê-lo, então o caminho
                // é não usar aquele passo. O PIX tem entrada própria abaixo.
                // Mensalidade é sempre à vista.
                minInstallments: 1,
                maxInstallments: 1,
              },
            }}
            onSubmit={onSubmit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div>
            <p className="font-medium">Pagar com PIX</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              O QR Code e o código copia-e-cola aparecem aqui na tela, na hora.
            </p>
          </div>
          <Button size="lg" onClick={gerarPix} disabled={gerandoPix}>
            {gerandoPix ? <Loader2 className="animate-spin" /> : <QrCode />}
            Gerar código PIX
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
