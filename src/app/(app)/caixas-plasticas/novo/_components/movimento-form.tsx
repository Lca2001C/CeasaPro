"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { registrarMovimentoCaixa } from "@/actions/caixas.actions";
import { CRATE_MOVEMENT_LABELS, toOptions } from "@/lib/labels";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function MovimentoCaixaForm() {
  const router = useRouter();
  const [type, setType] = useState("ENTRADA");
  const [quantity, setQuantity] = useState("");
  const [brokenQty, setBrokenQty] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [movementDate, setMovementDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const needsCustomer = type === "SAIDA" || type === "RETORNO";
  const isEntrada = type === "ENTRADA";
  const isQuebra = type === "QUEBRA";

  async function submit() {
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return toast.error("Informe a quantidade.");
    if (needsCustomer && !customerName.trim()) return toast.error("Informe o cliente.");

    setSaving(true);
    const res = await registrarMovimentoCaixa({
      type: type as "ENTRADA",
      quantity: qty,
      brokenQty: isEntrada && brokenQty ? parseInt(brokenQty, 10) : undefined,
      customerName: customerName.trim() || null,
      supplierName: supplierName.trim() || null,
      movementDate,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Movimentação registrada.");
      router.push("/caixas-plasticas");
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Tipo de movimentação</Label>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {toOptions(CRATE_MOVEMENT_LABELS).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Quantidade de caixas</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Data</Label>
          <Input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
        </div>
      </div>

      {isEntrada && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Origem / fornecedor (opcional)</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Caixas quebradas na chegada (opcional)</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={brokenQty}
              onChange={(e) => setBrokenQty(e.target.value)}
            />
          </div>
        </>
      )}

      {(needsCustomer || isQuebra) && (
        <div className="flex flex-col gap-1.5">
          <Label>
            {isQuebra ? "Cliente (se a caixa sumiu com um cliente — opcional)" : "Cliente"}
          </Label>
          <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Observações (opcional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={submit} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Registrar
        </Button>
      </div>
    </div>
  );
}
