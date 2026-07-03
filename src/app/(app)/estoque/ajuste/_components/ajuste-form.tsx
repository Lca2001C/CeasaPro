"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QuantityInput } from "@/components/forms/quantity-input";

const TIPOS = [
  { value: "QUEBRA", label: "Quebra / Perda" },
  { value: "DOACAO", label: "Doação" },
  { value: "AJUSTE", label: "Ajuste (entrada)" },
];

export function AjusteForm({ produtos }: { produtos: { id: string; name: string }[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState(produtos[0]?.id ?? "");
  const [type, setType] = useState("QUEBRA");
  const [quantity, setQuantity] = useState<number | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!productId) return toast.error("Selecione o produto.");
    if (!quantity || quantity <= 0) return toast.error("Informe a quantidade.");
    setSaving(true);
    const res = await apiPost("/api/estoque/ajuste", {
      productId,
      type,
      quantity,
      reason: reason || null,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Movimentação registrada.");
      router.push("/estoque");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Produto</Label>
        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Tipo de movimentação</Label>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {TIPOS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Quantidade</Label>
        <QuantityInput value={quantity} onChange={setQuantity} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Motivo (opcional)</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
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
