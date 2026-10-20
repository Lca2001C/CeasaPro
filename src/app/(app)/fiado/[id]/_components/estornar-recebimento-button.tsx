"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { estornarRecebimento } from "@/actions/fiado.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chamarAction } from "@/lib/http/chamar-action";
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
 * Estornar um recebimento de fiado lançado errado (até 24 h depois).
 *
 * O recebimento fica no extrato marcado como estornado; o valor sai do fluxo
 * de caixa e volta ao saldo do cliente (`FiadoService.estornarPagamento`).
 */
export function EstornarRecebimentoButton({
  paymentId,
  valor,
}: {
  paymentId: string;
  valor: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const res = await chamarAction(() =>
        estornarRecebimento({ paymentId, motivo: motivo.trim() || null }),
      );
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Recebimento de ${valor} estornado. O valor voltou ao saldo do cliente.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
        <Undo2 className="size-4" /> Estornar
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Estornar o recebimento de {valor}?</DialogTitle>
          <DialogDescription>
            Use quando o recebimento foi lançado errado — valor, forma de pagamento ou cliente.
            Ele fica no extrato marcado como estornado. Ao confirmar:
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>o valor sai do fluxo de caixa;</li>
          <li>o valor volta para o saldo que o cliente deve;</li>
          <li>fica registrado na auditoria quem estornou e por quê.</li>
        </ul>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`motivo-estorno-${paymentId}`}>Motivo (opcional)</Label>
          <Input
            id={`motivo-estorno-${paymentId}`}
            placeholder="Ex.: valor digitado errado"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Voltar</Button>
          </DialogClose>
          <Button variant="destructive" onClick={confirmar} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Estornar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
