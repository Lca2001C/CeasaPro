"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL, formatDateTime } from "@/lib/format";
import type { PixCharge } from "@/lib/payments/pix-charge";

export type { PixCharge };

/**
 * Cobrança PIX na tela: QR Code para escanear e copia-e-cola para colar no app
 * do banco. Nada é enviado por e-mail — o código fica aqui até ser pago.
 *
 * O copia-e-cola aparece **em texto**, não só atrás de um botão: quem paga pelo
 * computador escaneia com o celular, mas quem já está no celular precisa ver e
 * selecionar o código. E se o Mercado Pago não mandar a imagem do QR, o
 * copia-e-cola (ou o link do comprovante) ainda resolve.
 */
export function PixChargePanel({ charge }: { charge: PixCharge }) {
  const [copiado, setCopiado] = useState(false);
  const qrCode = charge.qrCode;

  async function copiar() {
    if (!qrCode) return;
    try {
      await navigator.clipboard.writeText(qrCode);
      setCopiado(true);
      toast.success("Código PIX copiado. Cole no app do seu banco.");
      setTimeout(() => setCopiado(false), 3000);
    } catch {
      // Contexto sem permissão de área de transferência (http, iframe, navegador
      // antigo): o código está visível na tela, então dá para copiar na mão.
      toast.error("Não foi possível copiar. Selecione o código abaixo e copie.");
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 pt-6">
        <div className="text-center">
          <p className="font-medium">Pague com PIX para ativar o acesso</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatBRL(charge.amount)}
            {charge.expiresAt ? ` · vale até ${formatDateTime(charge.expiresAt)}` : ""}
          </p>
        </div>

        {charge.qrCodeBase64 ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${charge.qrCodeBase64}`}
              alt="QR Code do PIX"
              className="size-56 rounded-lg border bg-white p-2"
            />
            <p className="text-xs text-muted-foreground">
              Abra o app do banco, escolha PIX e escaneie o código acima.
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center">
            <QrCode className="size-8 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Use o código copia-e-cola abaixo no app do seu banco.
            </p>
          </div>
        )}

        {qrCode && (
          <div className="w-full">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              PIX copia-e-cola
            </p>
            <textarea
              readOnly
              value={qrCode}
              onFocus={(e) => e.currentTarget.select()}
              rows={3}
              aria-label="Código PIX copia-e-cola"
              className="w-full resize-none rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-snug break-all"
            />
            <Button className="mt-2 w-full" onClick={copiar}>
              {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copiado ? "Código copiado" : "Copiar código PIX"}
            </Button>
          </div>
        )}

        {!qrCode && charge.ticketUrl && (
          <Button asChild variant="outline" className="w-full">
            <a href={charge.ticketUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" /> Abrir o QR Code
            </a>
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
