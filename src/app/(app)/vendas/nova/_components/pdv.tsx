"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Minus, Trash2, Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { formatBRL } from "@/lib/format";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";

interface Produto {
  id: string;
  name: string;
  saleUnit: string;
}
interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

const PAYMENTS = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "PIX", label: "PIX" },
  { value: "CARTAO", label: "Cartão" },
  { value: "FIADO", label: "Fiado" },
] as const;

export function Pdv({ produtos }: { produtos: Produto[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]["value"]>("DINHEIRO");
  const [customer, setCustomer] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return produtos.slice(0, 8);
    return produtos.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 12);
  }, [search, produtos]);

  const total = cart.reduce((a, i) => a + i.quantity * (i.unitPrice || 0), 0);

  function addProduct(p: Produto) {
    setCart((c) => {
      const found = c.find((i) => i.productId === p.id);
      if (found)
        return c.map((i) => (i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...c, { productId: p.id, name: p.name, quantity: 1, unitPrice: 0 }];
    });
    setSearch("");
  }

  function updateItem(id: string, patch: Partial<CartItem>) {
    setCart((c) => c.map((i) => (i.productId === id ? { ...i, ...patch } : i)));
  }
  function removeItem(id: string) {
    setCart((c) => c.filter((i) => i.productId !== id));
  }

  async function finalizar() {
    if (cart.length === 0) return toast.error("Adicione ao menos um produto.");
    if (cart.some((i) => i.quantity <= 0)) return toast.error("Quantidade inválida.");
    if (payment === "FIADO" && !customer.trim())
      return toast.error("Informe o cliente para venda fiada.");

    setSaving(true);
    const res = await apiPost<{ id: string }>("/api/vendas", {
      customerName: customer.trim() || null,
      paymentMethod: payment,
      items: cart.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice || 0,
      })),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(`Venda registrada: ${formatBRL(total)}`);
      setCart([]);
      setCustomer("");
      setPayment("DINHEIRO");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Frente de caixa</h1>

      {/* Busca de produtos */}
      <div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar produto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        {filtered.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {filtered.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                size="sm"
                onClick={() => addProduct(p)}
                type="button"
              >
                <Plus className="size-4" /> {p.name}
                <span className="text-xs text-muted-foreground">
                  {SALE_UNIT_LABELS[p.saleUnit]}
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Carrinho */}
      {cart.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <ShoppingCart className="mx-auto mb-2 size-8" />
          Toque em um produto para adicionar à venda.
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {cart.map((i) => (
            <Card key={i.productId} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${i.name}`}
                  onClick={() => removeItem(i.productId)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9"
                    aria-label="Diminuir quantidade"
                    onClick={() =>
                      updateItem(i.productId, { quantity: Math.max(0.001, i.quantity - 1) })
                    }
                  >
                    <Minus className="size-4" />
                  </Button>
                  <span className="w-10 text-center tabular-nums">{i.quantity}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9"
                    aria-label="Aumentar quantidade"
                    onClick={() => updateItem(i.productId, { quantity: i.quantity + 1 })}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
                <div className="flex-1">
                  <CurrencyInput
                    value={i.unitPrice}
                    onChange={(v) => updateItem(i.productId, { unitPrice: v ?? 0 })}
                  />
                </div>
                <span className="w-24 text-right font-semibold tabular-nums">
                  {formatBRL(i.quantity * (i.unitPrice || 0))}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Pagamento */}
      <div className="grid grid-cols-4 gap-2">
        {PAYMENTS.map((p) => (
          <Button
            key={p.value}
            type="button"
            variant={payment === p.value ? "default" : "outline"}
            onClick={() => setPayment(p.value)}
            className={cn("h-12")}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {payment === "FIADO" && (
        <Input
          placeholder="Nome do cliente (fiado)"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        />
      )}

      {/* Total + finalizar (rodapé fixo no mobile) */}
      <div className="sticky bottom-16 z-10 mt-2 rounded-lg border bg-background p-3 shadow-lg md:bottom-0">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground">Total</span>
          <span className="text-2xl font-bold tabular-nums">{formatBRL(total)}</span>
        </div>
        <Button size="lg" className="w-full" onClick={finalizar} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Finalizar venda
        </Button>
      </div>
    </div>
  );
}
