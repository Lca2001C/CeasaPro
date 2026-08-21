"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { formatBRL } from "@/lib/format";
import { RECIPIENT_TYPE_LABELS, SALE_UNIT_LABELS, toOptions } from "@/lib/labels";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";
import { QuantityInput } from "@/components/forms/quantity-input";
import { PhoneInput } from "@/components/forms/phone-input";

interface Produto {
  id: string;
  name: string;
  saleUnit: string;
}

interface Item {
  productId: string;
  quantity: number;
  unitPrice: number;
  recipientType: string;
  crateQty: number;
}

const novoItem = (produtos: Produto[]): Item => ({
  productId: produtos[0]?.id ?? "",
  quantity: 1,
  unitPrice: 0,
  recipientType: "",
  crateQty: 0,
});

export function FiadoForm({
  produtos,
  caixasLimpas,
}: {
  produtos: Produto[];
  caixasLimpas: number;
}) {
  const router = useRouter();
  const hoje = new Date().toISOString().slice(0, 10);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [saleDate, setSaleDate] = useState(hoje);
  const [dueDate, setDueDate] = useState("");
  const [usaCaixaPlastica, setUsaCaixaPlastica] = useState(false);
  const [plasticCrateQty, setPlasticCrateQty] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([novoItem(produtos)]);
  const [saving, setSaving] = useState(false);

  const total = items.reduce((a, i) => a + i.quantity * (i.unitPrice || 0), 0);

  function setItem(idx: number, patch: Partial<Item>) {
    setItems((s) => s.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function submit() {
    if (produtos.length === 0) return toast.error("Cadastre um produto primeiro.");
    if (!customerName.trim()) return toast.error("Informe o cliente.");
    if (items.some((i) => !i.productId || i.quantity <= 0))
      return toast.error("Preencha os itens corretamente.");

    const caixas = usaCaixaPlastica ? parseInt(plasticCrateQty, 10) || 0 : 0;
    if (usaCaixaPlastica && caixas <= 0)
      return toast.error("Informe a quantidade de caixas plásticas.");

    setSaving(true);
    const res = await apiPost<{ id: string }>("/api/fiado", {
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || null,
      saleDate,
      dueDate: dueDate || null,
      plasticCrateQty: caixas,
      notes: notes.trim() || null,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice || 0,
        recipientType: i.recipientType || null,
        crateQty: i.crateQty || 0,
      })),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(`Fiado lançado: ${formatBRL(total)}`);
      router.push("/fiado");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cliente">Cliente</Label>
        <Input
          id="cliente"
          autoFocus
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="telefone">Telefone (opcional)</Label>
          <PhoneInput id="telefone" value={customerPhone} onChange={setCustomerPhone} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="saleDate">Data da venda</Label>
          <Input
            id="saleDate"
            type="date"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dueDate">Vencimento (opcional)</Label>
        <Input
          id="dueDate"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Produtos vendidos</Label>
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
                    {p.name} ({SALE_UNIT_LABELS[p.saleUnit]})
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setItems((s) => s.filter((_, i) => i !== idx))}
                disabled={items.length === 1}
                aria-label="Remover item"
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-muted-foreground">Vasilhame (opcional)</span>
                <Select
                  value={it.recipientType}
                  onChange={(e) => setItem(idx, { recipientType: e.target.value })}
                >
                  <option value="">— Nenhum —</option>
                  {toOptions(RECIPIENT_TYPE_LABELS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Vasilhames do item</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={it.crateQty || ""}
                  onChange={(e) =>
                    setItem(idx, { crateQty: parseInt(e.target.value, 10) || 0 })
                  }
                  disabled={!it.recipientType}
                />
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium tabular-nums">
                {formatBRL(it.quantity * (it.unitPrice || 0))}
              </span>
            </div>
          </Card>
        ))}
        <Button type="button" variant="outline" onClick={() => setItems((s) => [...s, novoItem(produtos)])}>
          <Plus /> Adicionar produto
        </Button>
      </div>

      <Card className="flex flex-col gap-3 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={usaCaixaPlastica}
            onChange={(e) => setUsaCaixaPlastica(e.target.checked)}
          />
          Saiu em caixa plástica
        </label>
        {usaCaixaPlastica && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="caixas">Quantidade de caixas plásticas</Label>
            <Input
              id="caixas"
              type="number"
              inputMode="numeric"
              min={1}
              value={plasticCrateQty}
              onChange={(e) => setPlasticCrateQty(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              {caixasLimpas} caixa(s) limpa(s) em estoque. As caixas ficam registradas como
              pendentes com o cliente.
            </span>
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Observação (opcional)</Label>
        <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <Card className="p-3">
        <div className="flex justify-between font-semibold">
          <span>Total da compra</span>
          <span className="text-xl tabular-nums">{formatBRL(total)}</span>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={submit} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Lançar fiado
        </Button>
      </div>
    </div>
  );
}
