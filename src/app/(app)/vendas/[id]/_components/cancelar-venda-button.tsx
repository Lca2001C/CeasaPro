"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cancelarVenda } from "@/actions/vendas.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * Cancelar venda.
 *
 * Confirma sempre, e diz o que vai acontecer: a mercadoria volta ao estoque, as
 * caixas voltam e o fiado é desfeito. Não é "excluir" — a venda continua no
 * histórico marcada como cancelada, e o motivo vai para a auditoria.
 */
export function CancelarVendaButton({
  id,
  total,
  temFiado,
  caixas,
}: {
  id: string;
  total: string;
  temFiado: boolean;
  caixas: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const res = await cancelarVenda({ id, motivo: motivo.trim() || null });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      const { itensDevolvidos, caixasEstornadas, caixasNaoEstornadas } = res.data;
      toast.success(
        `Venda cancelada. ${itensDevolvidos} produto(s) de volta ao estoque` +
          (caixasEstornadas > 0 ? ` e ${caixasEstornadas} caixa(s) ao estoque de limpas` : "") +
          ".",
      );
      // O que NÃO pôde ser desfeito precisa ser dito, não escondido.
      if (caixasNaoEstornadas > 0) {
        toast.warning(
          `${caixasNaoEstornadas} caixa(s) desta venda o cliente já havia devolvido — elas não foram estornadas de novo.`,
        );
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Ban className="size-4 text-destructive" /> Cancelar venda
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar esta venda de {total}?</DialogTitle>
          <DialogDescription>
            A venda sai dos totais e do faturamento, mas fica no histórico marcada como
            cancelada. Ao confirmar:
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>a mercadoria volta para o estoque;</li>
          {caixas > 0 && <li>as {caixas} caixa(s) plástica(s) voltam para as limpas;</li>}
          {temFiado && <li>a conta gerada no fiado é removida;</li>}
          <li>fica registrado na auditoria quem cancelou e por quê.</li>
        </ul>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="motivo-cancelamento">Motivo (opcional)</Label>
          <Input
            id="motivo-cancelamento"
            placeholder="Ex.: erro de digitação, cliente desistiu"
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
