"use client";

import { isoDateTz } from "@/lib/tz";
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
    isoDateTz(),
  );
  const [freight, setFreight] = useState(0);
  const [items, setItems] = useState<Item[]>([
    { productId: produtos[0]?.id ?? "", quantity: 1, unitPrice: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [veioEmCaixa, setVeioEmCaixa] = useState(false);
  const [caixasRecebidas, setCaixasRecebidas] = useState("");
  const [caixasQuebradas, setCaixasQuebradas] = useState("");
  const [caixasSujas, setCaixasSujas] = useState(false);

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

    const caixas = veioEmCaixa ? parseInt(caixasRecebidas, 10) || 0 : 0;
    const quebradas = veioEmCaixa ? parseInt(caixasQuebradas, 10) || 0 : 0;
    if (veioEmCaixa && caixas <= 0)
      return toast.error("Informe quantas caixas plásticas chegaram.");
    if (quebradas > caixas)
      return toast.error("As caixas quebradas não podem passar do total recebido.");

    setSaving(true);
    const res = await apiPost<{ id: string }>("/api/compras", {
      supplierId: supplierId || null,
      purchaseDate,
      freight: freight || 0,
      caixasRecebidas: caixas,
      caixasQuebradas: quebradas,
      caixasSujas: veioEmCaixa && caixasSujas,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice || 0,
      })),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(
        caixas > 0
          ? `Compra registrada. Estoque atualizado e ${caixas} caixa(s) na entrada.`
          : "Compra registrada. Estoque atualizado.",
      );
      router.push("/compras");
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
        <span className="text-xs text-muted-foreground">
          O frete entra no custo de cada produto automaticamente, rateado pelo valor.
        </span>
      </div>

      {/* Caixas plásticas que vieram junto: registrar aqui evita o segundo
          lançamento em outra tela — que era esquecido e fazia o saldo de
          caixas divergir do que existe no box. */}
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={veioEmCaixa}
            onChange={(e) => setVeioEmCaixa(e.target.checked)}
          />
          Chegou em caixa plástica
        </label>
        {veioEmCaixa && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="caixas-recebidas">Quantas caixas</Label>
                <Input
                  id="caixas-recebidas"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={caixasRecebidas}
                  onChange={(e) => setCaixasRecebidas(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="caixas-quebradas">Quebradas na chegada</Label>
                <Input
                  id="caixas-quebradas"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={caixasQuebradas}
                  onChange={(e) => setCaixasQuebradas(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={caixasSujas}
                onChange={(e) => setCaixasSujas(e.target.checked)}
              />
              Chegaram sujas (vão para a fila de higienização)
            </label>
          </div>
        )}
      </div>

      <Card className="p-3">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Subtotal dos itens</span>
          <span className="tabular-nums">{formatBRL(subtotal)}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm text-muted-foreground">
          <span>Frete</span>
          <span className="tabular-nums">{formatBRL(freight || 0)}</span>
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
