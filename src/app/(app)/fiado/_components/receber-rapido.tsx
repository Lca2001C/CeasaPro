"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CurrencyInput } from "@/components/forms/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Recebimento direto da lista, sem abrir a conta.
 *
 * Receber é a operação mais repetida do fiado — o cliente chega no box, paga e
 * vai embora. Exigir "abrir a conta → rolar até o formulário → voltar" a cada
 * pagamento é atrito puro. O valor já vem preenchido com o saldo, que é o caso
 * comum (pagou tudo).
 *
 * A regra de negócio é a mesma da tela de detalhe: mesma rota, mesma validação
 * no servidor (não deixa pagar acima do saldo). Isto é só um atalho de UI.
 */
export function ReceberRapido({
  accountId,
  customerName,
  saldo,
}: {
  accountId: string;
  customerName: string;
  saldo: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [amount, setAmount] = useState<number | undefined>(saldo);
  const [method, setMethod] = useState("DINHEIRO");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!amount || amount <= 0) return toast.error("Informe o valor recebido.");
    setSaving(true);
    const res = await apiPost("/api/fiado/pagamento", { accountId, amount, method });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    const quitou = amount >= saldo;
    toast.success(
      quitou
        ? `Conta de ${customerName} quitada.`
        : `Recebido ${formatBRL(amount)} · faltam ${formatBRL(saldo - amount)}.`,
    );
    setAberto(false);
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        // `preventDefault` porque o botão vive dentro do link da linha: sem
        // isso, tocar em "Receber" navegaria para o detalhe.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAmount(saldo);
          setAberto(true);
        }}
      >
        <HandCoins className="size-4" />
        <span className="hidden sm:inline">Receber</span>
      </Button>

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receber de {customerName}</DialogTitle>
            <DialogDescription>
              Saldo devedor: <b>{formatBRL(saldo)}</b>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Valor recebido</Label>
              <CurrencyInput value={amount} onChange={setAmount} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Forma</Label>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="DINHEIRO">Dinheiro</option>
                <option value="PIX">PIX</option>
                <option value="CARTAO">Cartão</option>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
