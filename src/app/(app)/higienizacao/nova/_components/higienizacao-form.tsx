"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { criarHigienizacao, atualizarHigienizacao } from "@/actions/higienizacao.actions";
import { formatBRL } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";

export interface HigienizacaoFormInitial {
  id: string;
  cleanerName: string;
  sentDate: string;
  sentQty: number;
  unitPrice: number;
  notes: string | null;
}

export function HigienizacaoForm({
  caixasSujas,
  initial,
}: {
  caixasSujas: number;
  initial?: HigienizacaoFormInitial;
}) {
  const router = useRouter();
  const [cleanerName, setCleanerName] = useState(initial?.cleanerName ?? "");
  const [sentDate, setSentDate] = useState(
    initial?.sentDate ?? new Date().toISOString().slice(0, 10),
  );
  const [sentQty, setSentQty] = useState(initial ? String(initial.sentQty) : "");
  const [unitPrice, setUnitPrice] = useState<number | undefined>(initial?.unitPrice);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const qty = parseInt(sentQty, 10) || 0;
  const total = qty * (unitPrice ?? 0);

  async function submit() {
    if (!cleanerName.trim()) return toast.error("Informe o higienizador.");
    if (qty <= 0) return toast.error("Informe a quantidade enviada.");

    const values = {
      cleanerName: cleanerName.trim(),
      sentDate,
      sentQty: qty,
      unitPrice: unitPrice ?? 0,
      notes: notes.trim() || null,
    };

    setSaving(true);
    const res = initial
      ? await atualizarHigienizacao({ ...values, id: initial.id })
      : await criarHigienizacao(values);
    setSaving(false);
    if (res.ok) {
<<<<<<< HEAD
      toast.success(initial ? "Envio atualizado." : "Envio registrado.");
      router.push(initial ? `/higienizacao/${initial.id}` : "/higienizacao");
      router.refresh();
=======
      toast.success("Envio registrado.");
      router.push("/higienizacao");
>>>>>>> f644e783a382991bbaf54b13f72f4aa83dfb88c6
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cleanerName">Higienizador responsável</Label>
        <Input
          id="cleanerName"
          autoFocus
          value={cleanerName}
          onChange={(e) => setCleanerName(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sentDate">Data de envio</Label>
          <Input
            id="sentDate"
            type="date"
            value={sentDate}
            onChange={(e) => setSentDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sentQty">Qtd. enviada</Label>
          <Input
            id="sentQty"
            type="number"
            inputMode="numeric"
            min={1}
            value={sentQty}
            onChange={(e) => setSentQty(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            {caixasSujas} caixa(s) suja(s) em estoque
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="unitPrice">Valor por caixa</Label>
        <CurrencyInput id="unitPrice" value={unitPrice} onChange={setUnitPrice} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Observações (opcional)</Label>
        <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          {initial ? "Salvar alterações" : "Registrar envio"}
        </Button>
      </div>
    </div>
  );
}
