"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { excluirFiado } from "@/actions/fiado.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Exclusão do lançamento de fiado.
 *
 * O texto do diálogo diz o que **de fato** acontece: a venda também é desfeita,
 * a mercadoria volta ao estoque e as caixas retornam. Sem isso, "excluir" soa
 * como esconder a linha da lista, e o operador só descobriria o efeito no
 * estoque depois — quando o número não fechasse.
 */
export function ExcluirFiado({
  accountId,
  customerName,
  temPagamento,
  itensCount,
  caixasDaVenda,
}: {
  accountId: string;
  customerName: string;
  /** Com pagamento registrado o servidor recusa; a UI nem oferece o botão. */
  temPagamento: boolean;
  itensCount: number;
  caixasDaVenda: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pending, start] = useTransition();

  if (temPagamento) return null;

  function excluir() {
    start(async () => {
      const res = await excluirFiado(accountId);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Lançamento excluído e venda desfeita.");
      router.replace("/fiado");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="self-start text-destructive"
        onClick={() => setAberto(true)}
      >
        <Trash2 className="size-4" /> Excluir lançamento
      </Button>

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir o fiado de {customerName}?</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-2">
                <span>Isto desfaz a operação inteira, não só a conta a receber:</span>
                <ul className="list-disc pl-5">
                  <li>a venda sai do faturamento;</li>
                  {itensCount > 0 && (
                    <li>
                      {itensCount} item(ns) <b>voltam para o estoque</b>;
                    </li>
                  )}
                  {caixasDaVenda > 0 && (
                    <li>
                      {caixasDaVenda} caixa(s) plástica(s) <b>retornam</b> como limpas;
                    </li>
                  )}
                  <li>fica registrado na auditoria.</li>
                </ul>
                <span>Não tem desfazer.</span>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={excluir} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Excluir e desfazer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
