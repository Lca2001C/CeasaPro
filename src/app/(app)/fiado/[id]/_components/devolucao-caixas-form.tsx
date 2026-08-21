"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { registrarDevolucaoCaixas } from "@/actions/fiado.actions";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Cliente devolveu caixas — voltam sujas para o estoque, prontas para higienizar. */
export function DevolucaoCaixasForm({
  accountId,
  maximo,
}: {
  accountId: string;
  maximo: number;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(maximo));
  const [movementDate, setMovementDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function submit() {
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return toast.error("Informe a quantidade de caixas.");
    if (qty > maximo) return toast.error(`O cliente tem ${maximo} caixa(s) com ele.`);

    setSaving(true);
    const res = await registrarDevolucaoCaixas({ accountId, quantity: qty, movementDate });
    setSaving(false);
    if (res.ok) {
      toast.success("Devolução de caixas registrada.");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="devolucao-qty">Caixas devolvidas</Label>
          <Input
            id="devolucao-qty"
            type="number"
            inputMode="numeric"
            min={1}
            max={maximo}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="devolucao-data">Data</Label>
          <Input
            id="devolucao-data"
            type="date"
            value={movementDate}
            onChange={(e) => setMovementDate(e.target.value)}
          />
        </div>
      </div>
      <Button variant="outline" onClick={submit} disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Registrar devolução
      </Button>
    </div>
  );
}
