"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cancelarCompra } from "@/actions/compras.actions";
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
 * Cancelar compra lançada errada (até 24 h depois do registro).
 *
 * O diálogo diz o que de fato acontece — no molde de `CancelarVendaButton`: a
 * mercadoria sai do estoque, a conta da compra é cancelada e a compra fica na
 * lista marcada. O caso de uso é "lancei errado, vou lançar de novo".
 */
export function CancelarCompraButton({ id, total }: { id: string; total: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const res = await chamarAction(() => cancelarCompra({ id, motivo: motivo.trim() || null }));
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(
        "Compra cancelada. A mercadoria saiu do estoque" +
          (res.data.caixasEstornadas > 0
            ? ` e ${res.data.caixasEstornadas} caixa(s) plástica(s) também`
            : "") +
          ". Lance a compra certa em Registrar compra.",
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
        <Ban className="size-4" /> Cancelar compra
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar esta compra de {total}?</DialogTitle>
          <DialogDescription>
            Use quando a compra foi lançada errada. Ela fica na lista marcada como cancelada e sai
            dos totais. Ao confirmar:
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>a mercadoria sai do estoque, e o custo dela sai do custo médio;</li>
          <li>as caixas plásticas que chegaram com ela saem do estoque;</li>
          <li>a conta da compra é cancelada — mesmo já paga, sai do fluxo de caixa;</li>
          <li>fica registrado na auditoria quem cancelou e por quê.</li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Só dá para cancelar enquanto os produtos desta compra não tiveram venda, baixa nem
          ajuste depois dela.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`motivo-compra-${id}`}>Motivo (opcional)</Label>
          <Input
            id={`motivo-compra-${id}`}
            placeholder="Ex.: quantidade errada, fornecedor trocado"
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
            Cancelar a compra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
