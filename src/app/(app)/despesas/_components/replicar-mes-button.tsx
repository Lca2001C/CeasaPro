"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { replicarMesDeDespesas } from "@/actions/despesas.actions";
import { Button } from "@/components/ui/button";
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
 * "Replicar mês anterior" — a alternativa manual à recorrência automática.
 *
 * Confirma antes porque cria várias contas de uma vez. O serviço só copia o que
 * ainda não tem cópia, então um segundo toque não duplica nada; a confirmação
 * existe para o usuário saber o que vai acontecer, não para proteger o dado.
 */
export function ReplicarMesButton({ mesOrigem }: { mesOrigem: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function replicar() {
    start(async () => {
      const res = await replicarMesDeDespesas({ origem: mesOrigem });
      if (res.ok) {
        const { criadas, encontradas } = res.data;
        toast.success(
          criadas > 0
            ? `${criadas} conta(s) copiada(s) para o mês seguinte`
            : `Nada a copiar: as ${encontradas} conta(s) de ${mesOrigem} já foram replicadas`,
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CopyPlus className="size-4" /> Replicar mês anterior
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copiar as contas de {mesOrigem}?</DialogTitle>
          <DialogDescription>
            Cada conta com vencimento em {mesOrigem} ganha uma cópia pendente no mês seguinte,
            com o mesmo valor e categoria. Contas já copiadas são ignoradas, então você pode
            repetir sem risco de duplicar.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <Button onClick={replicar} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Copiar contas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
