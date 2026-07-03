"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { formatBRL } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";
import { QuantityInput } from "@/components/forms/quantity-input";

interface Option {
  id: string;
  name: string;
}
interface Item {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export function CompraForm({
  produtos,
  fornecedores,
}: {
  produtos: Option[];
  fornecedores: Option[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [freight, setFreight] = useState(0);
  const [items, setItems] = useState<Item[]>([
    { productId: produtos[0]?.id ?? "", quantity: 1, unitPrice: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  const subtotal = items.reduce((a, i) => a + i.quantity * (i.unitPrice || 0), 0);
  const total = subtotal + (freight || 0);

  function setItem(idx: number, patch: Partial<Item>) {
    setItems((s) => s.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((s) => [...s, { productId: produtos[0]?.id ?? "", quantity: 1, unitPrice: 0 }]);
  }
  function removeItem(idx: number) {
    setItems((s) => s.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (produtos.length === 0) return toast.error("Cadastre um produto primeiro.");
    if (items.some((i) => !i.productId || i.quantity <= 0))
      return toast.error("Preencha os itens corretamente.");

    setSaving(true);
    const res = await apiPost<{ id: string }>("/api/compras", {
      supplierId: supplierId || null,
      purchaseDate,
      freight: freight || 0,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice || 0,
      })),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Compra registrada. Estoque atualizado.");
      router.push("/compras");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Data</Label>
          <Input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Fornecedor</Label>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Sem fornecedor —</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Itens</Label>
        {items.map((it, idx) => (
          <Card key={idx} className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-2">
              <Select
                className="flex-1"
                value={it.productId}
                onChange={(e) => setItem(idx, { productId: e.target.value })}
              >
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-muted-foreground">Quantidade</span>
                <QuantityInput
                  value={it.quantity}
                  onChange={(v) => setItem(idx, { quantity: v ?? 0 })}
                />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Preço unitário</span>
                <CurrencyInput
                  value={it.unitPrice}
                  onChange={(v) => setItem(idx, { unitPrice: v ?? 0 })}
                />
              </div>
            </div>
          </Card>
        ))}
        <Button type="button" variant="outline" onClick={addItem}>
          <Plus /> Adicionar item
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Frete</Label>
        <CurrencyInput value={freight} onChange={(v) => setFreight(v ?? 0)} />
      </div>

      <Card className="p-3">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Subtotal dos itens</span>
          <span className="tabular-nums">{formatBRL(subtotal)}</span>
        </div>
        <div className="mt-1 flex justify-between font-semibold">
          <span>Total da compra</span>
          <span className="tabular-nums">{formatBRL(total)}</span>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={submit} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Salvar compra
        </Button>
      </div>
    </div>
  );
}
