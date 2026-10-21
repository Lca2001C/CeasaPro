"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TrendingDown, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { baixarFiadoComoPerda, desfazerBaixaDoFiado } from "@/actions/fiado.actions";
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
 * "Baixar como perda": o fiado que não vai ser pago sai da cobrança e entra no
 * resultado do mês de HOJE como "Perda com fiado" (`FiadoService.baixarComoPerda`).
 *
 * É a saída para o fiado incobrável depois do prazo de cancelar a venda. O
 * texto deixa claro que a venda continua existindo — a mercadoria saiu — e
 * que o que muda é o que você espera receber.
 */
export function BaixarComoPerda({
  accountId,
  customerName,
  saldo,
}: {
  accountId: string;
  customerName: string;
  /** Saldo já formatado ("R$ 120,00"). */
  saldo: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const res = await chamarAction(() =>
        baixarFiadoComoPerda({ id: accountId, motivo: motivo.trim() }),
      );
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Fiado de ${customerName} baixado como perda.`);
      setAberto(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <Button variant="warning" size="sm" className="self-start" onClick={() => setAberto(true)}>
        <TrendingDown className="size-4" /> Baixar como perda
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Baixar o fiado de {customerName} como perda?</DialogTitle>
          <DialogDescription>
            Use quando o cliente não vai pagar. A venda continua no histórico — a mercadoria saiu.
            Ao confirmar:
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            os <b>{saldo}</b> que faltam saem do &quot;a receber&quot; e dos avisos de fiado vencido;
          </li>
          <li>
            esse valor entra como <b>Perda com fiado</b> no resultado deste mês (o mês da venda não
            muda);
          </li>
          <li>
            se o cliente pagar depois, o valor entra no resultado do mês em que você receber;
          </li>
          <li>dá para desfazer só nas próximas 24 h.</li>
        </ul>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="motivo-baixa-fiado">Motivo</Label>
          <Input
            id="motivo-baixa-fiado"
            placeholder="Ex.: cliente fechou o box e não pagou"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Voltar</Button>
          </DialogClose>
          <Button
            variant="warning"
            onClick={confirmar}
            disabled={pending || motivo.trim().length < 3}
          >
            {pending && <Loader2 className="animate-spin" />}
            Baixar como perda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Desfaz a baixa lançada errada — só nas 24 h seguintes (regra única de desfazer). */
export function DesfazerBaixa({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function desfazer() {
    start(async () => {
      const res = await chamarAction(() => desfazerBaixaDoFiado({ id: accountId }));
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Baixa desfeita. O fiado voltou para a cobrança.");
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" className="self-start" onClick={desfazer} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Undo2 className="size-4" />}
      Desfazer a baixa
    </Button>
  );
}
