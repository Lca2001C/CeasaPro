"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { criarVendaEmbalagem } from "@/actions/embalagens.actions";
import { formatBRL } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";

export function VendaEmbalagemForm({ tipos }: { tipos: { id: string; name: string }[] }) {
  const router = useRouter();
  const [packagingTypeId, setPackagingTypeId] = useState(tipos[0]?.id ?? "");
  const [customerName, setCustomerName] = useState("");
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const qty = parseInt(quantity, 10) || 0;
  const total = qty * (unitPrice ?? 0);

  async function submit() {
    if (!packagingTypeId) return toast.error("Selecione o tipo de embalagem.");
    if (qty <= 0) return toast.error("Informe a quantidade.");
    setSaving(true);
    const res = await criarVendaEmbalagem({
      packagingTypeId,
      customerName: customerName.trim() || null,
      saleDate,
      quantity: qty,
      unitPrice: unitPrice ?? 0,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Venda de embalagem registrada.");
      router.push("/embalagens");
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Tipo de embalagem</Label>
        <Select value={packagingTypeId} onChange={(e) => setPackagingTypeId(e.target.value)}>
          {tipos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Cliente (opcional)</Label>
        <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Data</Label>
          <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Quantidade</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Valor unitário</Label>
        <CurrencyInput value={unitPrice} onChange={setUnitPrice} />
      </div>

      <Card className="flex items-center justify-between p-3">
        <span className="text-sm text-muted-foreground">Valor total</span>
        <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
      </Card>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={submit} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}
