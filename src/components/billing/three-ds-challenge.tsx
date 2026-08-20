"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const FRAME_NAME = "three-ds-challenge-frame";

/**
 * Desafio 3-D Secure do cartão de débito.
 * O emissor exige um POST com o `creq` para a URL do desafio, renderizado num
 * iframe. Quando o portador conclui a autenticação, o Mercado Pago finaliza o
 * pagamento e avisa pelo webhook — a tela detecta pelo polling de status.
 */
export function ThreeDsChallenge({ url, creq }: { url: string; creq?: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (creq) formRef.current?.submit();
  }, [url, creq]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <p className="text-center font-medium">Autenticação do seu banco</p>
        <p className="text-center text-sm text-muted-foreground">
          Conclua a verificação abaixo para autorizar o pagamento no débito.
        </p>
        {creq && (
          <form ref={formRef} action={url} method="POST" target={FRAME_NAME} hidden>
            <input type="hidden" name="creq" value={creq} />
          </form>
        )}
        <iframe
          name={FRAME_NAME}
          title="Autenticação do banco (3-D Secure)"
          src={creq ? undefined : url}
          className="h-[420px] w-full rounded-lg border"
        />
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Aguardando a confirmação do banco — não feche esta página.
        </p>
      </CardContent>
    </Card>
  );
}
