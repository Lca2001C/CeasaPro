"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cancelarVendaEmbalagem } from "@/actions/embalagens.actions";
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
 * Cancela a venda de embalagem lançada errada — a regra única de desfazer
 * (até 24 h). A venda fica na lista, riscada; o estoque volta.
 */
export function CancelarVendaEmbalagem({ id, descricao }: { id: string; descricao: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const res = await chamarAction(() =>
        cancelarVendaEmbalagem({ id, motivo: motivo.trim() || null }),
      );
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Venda cancelada.");
      setAberto(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <Button variant="destructive" size="sm" onClick={() => setAberto(true)}>
        <Ban /> Cancelar
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar a venda de {descricao}?</DialogTitle>
          <DialogDescription>
            Use quando a venda foi lançada errada. Ela continua na lista, riscada, e sai dos
            totais; se o tipo controla estoque, as embalagens voltam para o saldo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`motivo-cancelar-emb-${id}`}>Motivo (opcional)</Label>
          <Input
            id={`motivo-cancelar-emb-${id}`}
            placeholder="Ex.: quantidade errada"
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
            Cancelar a venda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
