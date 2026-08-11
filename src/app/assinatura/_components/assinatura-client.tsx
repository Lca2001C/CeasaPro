"use client";

import { useState } from "react";
import { Loader2, Copy, QrCode, CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface Charge {
  method: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  preferenceId?: string | null;
  amount: string;
}

export function AssinaturaClient({
  mpConfigured,
  initialCharge,
}: {
  mpConfigured: boolean;
  initialCharge: Charge | null;
}) {
  const [pixCharge, setPixCharge] = useState<Charge | null>(
    initialCharge?.qrCodeBase64 ? initialCharge : null,
  );
  const [cardCharge, setCardCharge] = useState<Charge | null>(null);
  const [loading, setLoading] = useState<"pix" | "card" | null>(null);

  async function gerar(method: "pix" | "card") {
    setLoading(method);
    const res = await apiPost<Charge>("/api/billing/checkout", { method });
    setLoading(null);
    if (!res.ok) return toast.error(res.error.message);

    if (method === "pix") {
      setPixCharge(res.data);
    } else {
      setCardCharge(res.data);
      if (res.data.ticketUrl) {
        window.open(res.data.ticketUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Não foi possível abrir o checkout do cartão.");
      }
    }
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

  return (
    <Tabs defaultValue="pix">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="pix">
          <QrCode className="mr-1 size-4" /> PIX
        </TabsTrigger>
        <TabsTrigger value="card">
          <CreditCard className="mr-1 size-4" /> Cartão
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pix">
        {pixCharge?.qrCodeBase64 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
              <p className="font-medium">Pague com PIX para ativar/renovar</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${pixCharge.qrCodeBase64}`}
                alt="QR Code PIX"
                className="size-56 rounded-lg border"
              />
              {pixCharge.qrCode && (
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(pixCharge.qrCode!);
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
        ) : (
          <Button
            size="lg"
            className="w-full"
            onClick={() => gerar("pix")}
            disabled={loading !== null}
          >
            {loading === "pix" ? <Loader2 className="animate-spin" /> : <QrCode />} Gerar
            cobrança PIX
          </Button>
        )}
      </TabsContent>

      <TabsContent value="card">
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            className="w-full"
            onClick={() => gerar("card")}
            disabled={loading !== null}
          >
            {loading === "card" ? <Loader2 className="animate-spin" /> : <CreditCard />} Pagar
            com cartão
          </Button>
          {cardCharge?.ticketUrl && (
            <Button asChild variant="outline">
              <a href={cardCharge.ticketUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Reabrir checkout do cartão
              </a>
            </Button>
          )}
          <p className="text-center text-xs text-muted-foreground">
            Você será levado ao ambiente seguro do Mercado Pago. O acesso é liberado assim que o
            pagamento for aprovado.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
