"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { criarHigienizacao } from "@/actions/higienizacao.actions";
import { formatBRL } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";

export function HigienizacaoForm() {
  const router = useRouter();
  const [cleanerName, setCleanerName] = useState("");
  const [sentDate, setSentDate] = useState(new Date().toISOString().slice(0, 10));
  const [sentQty, setSentQty] = useState("");
  const [unitPrice, setUnitPrice] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const qty = parseInt(sentQty, 10) || 0;
  const total = qty * (unitPrice ?? 0);

  async function submit() {
    if (!cleanerName.trim()) return toast.error("Informe o higienizador.");
    if (qty <= 0) return toast.error("Informe a quantidade enviada.");
    setSaving(true);
    const res = await criarHigienizacao({
      cleanerName: cleanerName.trim(),
      sentDate,
      sentQty: qty,
      unitPrice: unitPrice ?? 0,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Envio registrado.");
      router.push("/higienizacao");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Higienizador responsável</Label>
        <Input autoFocus value={cleanerName} onChange={(e) => setCleanerName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Data de envio</Label>
          <Input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Qtd. enviada</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={sentQty}
            onChange={(e) => setSentQty(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Valor por caixa</Label>
        <CurrencyInput value={unitPrice} onChange={setUnitPrice} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Observações (opcional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <Card className="flex items-center justify-between p-3">
        <span className="text-sm text-muted-foreground">Valor total do serviço</span>
        <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
      </Card>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={submit} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Registrar envio
        </Button>
      </div>
    </div>
  );
}
