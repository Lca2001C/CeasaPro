"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cancelarAssinatura, reativarAssinatura } from "@/actions/plano.actions";
import { apiPost } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Cancelar / desfazer cancelamento da assinatura.
 *
 * Confirma sempre. O texto muda com a situação: mês pago continua até o
 * vencimento; teste grátis e período já vencido encerram na hora. Desfazer só
 * aparece enquanto o mês pago ainda vale — depois o caminho é pagar de novo.
 */
export function CancelarAssinatura({
  cancelledAt,
  currentPeriodEnd,
  status,
}: {
  cancelledAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
  status: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const periodoPago = status === "ATIVO" && Boolean(currentPeriodEnd);
  const vencimento = currentPeriodEnd ? formatDate(currentPeriodEnd) : null;

  function aposAcao() {
    return apiPost("/api/auth/refresh", {}).then(() => router.refresh());
  }

  function confirmarCancelamento() {
    start(async () => {
      const res = await cancelarAssinatura();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setOpen(false);
      if (res.data.accessUntil) {
        toast.success(
          `Assinatura cancelada. Você continua usando até ${formatDate(res.data.accessUntil)}.`,
        );
        await aposAcao();
        return;
      }
      toast.success("Assinatura encerrada.");
      await aposAcao();
      window.location.assign("/conta/suspensa");
    });
  }

  function desfazer() {
    start(async () => {
      const res = await reativarAssinatura();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Cancelamento desfeito. A assinatura volta a renovar no vencimento.");
      await aposAcao();
    });
  }

  if (cancelledAt) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assinatura cancelada</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {periodoPago && vencimento
              ? `Não haverá próxima cobrança. Você continua usando até ${vencimento}.`
              : "A assinatura foi encerrada."}
          </p>
          {periodoPago && (
            <Button variant="outline" onClick={desfazer} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <RotateCcw className="size-4" />}
              Desfazer cancelamento
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cancelar assinatura</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Sem multa. O cancelamento só interrompe as cobranças seguintes.
        </p>
        <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
          <Ban className="size-4 text-destructive" /> Cancelar assinatura
        </Button>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancelar a assinatura?</DialogTitle>
              <DialogDescription>
                {status === "TRIAL"
                  ? "O teste grátis termina agora. Você pode voltar a qualquer momento contratando um plano."
                  : periodoPago && vencimento
                    ? `Você continua usando até ${vencimento}. Não haverá próxima cobrança.`
                    : "O período pago já venceu. O acesso será encerrado agora."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={pending}>
                  Voltar
                </Button>
              </DialogClose>
              <Button variant="destructive" onClick={confirmarCancelamento} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Confirmar cancelamento
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
