"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cancelarVendaDoFiado } from "@/actions/fiado.actions";
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
 * Desfazer o fiado = cancelar a venda dele, pelo mesmo caminho e prazo do
 * histórico de vendas (`FiadoService.cancelarVendaDoFiado`).
 *
 * O texto diz o que de fato acontece: a venda inteira é desfeita, não só a
 * conta a receber. Sem isso, "excluir" soa como esconder a linha da lista, e o
 * operador só descobriria o efeito no estoque quando o número não fechasse.
 */
export function CancelarVendaDoFiado({
  accountId,
  customerName,
  itensCount,
  caixasDaVenda,
  pagoNoBalcao,
}: {
  accountId: string;
  customerName: string;
  itensCount: number;
  caixasDaVenda: number;
  /** Parte da venda paga no balcão — volta ao cliente junto com a venda. */
  pagoNoBalcao: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const res = await chamarAction(() =>
        cancelarVendaDoFiado({ id: accountId, motivo: motivo.trim() || null }),
      );
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Venda cancelada e fiado desfeito.");
      if (res.data.caixasNaoEstornadas > 0) {
        toast.info(
          `${res.data.caixasNaoEstornadas} caixa(s) desta venda o cliente já havia devolvido — ` +
            "elas não voltaram ao estoque de novo.",
        );
      }
      router.replace("/fiado");
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <Button variant="destructive" size="sm" className="self-start" onClick={() => setAberto(true)}>
        <Ban className="size-4" /> Cancelar venda
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar a venda fiada de {customerName}?</DialogTitle>
          <DialogDescription>
            Use quando a venda foi lançada errada. Ela fica no histórico de vendas marcada como
            cancelada e sai dos totais. Ao confirmar:
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>a conta a receber sai do fiado;</li>
          {itensCount > 0 && (
            <li>
              {itensCount} item(ns) <b>voltam para o estoque</b>;
            </li>
          )}
          {caixasDaVenda > 0 && (
            <li>
              as caixas plásticas que o cliente ainda não devolveu <b>voltam</b> como limpas;
            </li>
          )}
          {pagoNoBalcao && (
            <li>
              os <b>{pagoNoBalcao}</b> pagos no balcão saem do fluxo de caixa (devolva ao cliente);
            </li>
          )}
          <li>fica registrado na auditoria quem cancelou e por quê.</li>
        </ul>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="motivo-cancelar-fiado">Motivo (opcional)</Label>
          <Input
            id="motivo-cancelar-fiado"
            placeholder="Ex.: lancei no cliente errado"
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
