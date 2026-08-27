"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Container,
  HandCoins,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { formatBRL } from "@/lib/format";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

/** id do `<datalist>` que alimenta o autocomplete de cliente. */
const LISTA_CLIENTES = "pdv-clientes-conhecidos";

/** O que a venda mudou no sistema — mostrado na confirmação. */
interface ResumoVenda {
  total: number;
  itens: number;
  pagamento: string;
  cliente: string | null;
  fiado: boolean;
  caixas: number;
}

const PAYMENTS = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "PIX", label: "PIX" },
  { value: "CARTAO", label: "Cartão" },
  { value: "FIADO", label: "Fiado" },
] as const;

export function Pdv({
  produtos,
  caixasLimpas,
  ultimosPrecos = {},
  clientesConhecidos = [],
}: {
  produtos: Produto[];
  caixasLimpas: number;
  /** Último preço vendido por produto — só sugestão, o campo segue editável. */
  ultimosPrecos?: Record<string, number>;
  /** Clientes já atendidos, para autocompletar e evitar nomes duplicados. */
  clientesConhecidos?: string[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]["value"]>("DINHEIRO");
  const [customer, setCustomer] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [usaCaixaPlastica, setUsaCaixaPlastica] = useState(false);
  const [crateQty, setCrateQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [resumo, setResumo] = useState<ResumoVenda | null>(null);

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
      // Sugere o último preço praticado. Zero significa "nunca vendido" — aí
      // o campo abre vazio mesmo, e o operador digita.
      return [
        ...c,
        { productId: p.id, name: p.name, quantity: 1, unitPrice: ultimosPrecos[p.id] ?? 0 },
      ];
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

    const caixas = usaCaixaPlastica ? parseInt(crateQty, 10) || 0 : 0;
    if (usaCaixaPlastica && caixas <= 0)
      return toast.error("Informe a quantidade de caixas plásticas.");
    if (caixas > 0 && !customer.trim())
      return toast.error("Informe o cliente para controlar as caixas plásticas.");

    setSaving(true);
    const res = await apiPost<{ id: string }>("/api/vendas", {
      customerName: customer.trim() || null,
      paymentMethod: payment,
      dueDate: payment === "FIADO" && dueDate ? dueDate : null,
      plasticCrateQty: caixas,
      items: cart.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice || 0,
      })),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }

    // Resumo do que a venda MUDOU, não só "deu certo": o operador precisa
    // saber que o estoque baixou, que virou fiado ou que as caixas saíram —
    // é a diferença entre confiar no sistema e conferir tudo à mão depois.
    setResumo({
      total,
      itens: cart.length,
      pagamento: PAYMENTS.find((p) => p.value === payment)?.label ?? payment,
      cliente: customer.trim() || null,
      fiado: payment === "FIADO",
      caixas,
    });

    setCart([]);
    setCustomer("");
    setDueDate("");
    setUsaCaixaPlastica(false);
    setCrateQty("");
    setPayment("DINHEIRO");
    router.refresh();
  }

  // Confirmação toma a tela inteira de propósito: no balcão, um toast some
  // antes de o operador levantar os olhos do troco.
  if (resumo) {
    return (
      <div className="flex flex-col gap-4">
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
            <CheckCircle2 className="size-12 text-success" />
            <div>
              <p className="text-2xl font-bold tabular-nums text-success">
                {formatBRL(resumo.total)}
              </p>
              <p className="text-sm text-muted-foreground">
                Venda registrada · {resumo.pagamento}
              </p>
            </div>

            <ul className="w-full space-y-1 text-left text-sm">
              <li className="flex items-center gap-2">
                <Package className="size-4 shrink-0 text-muted-foreground" />
                Estoque baixado — {resumo.itens} produto(s)
              </li>
              {resumo.fiado && (
                <li className="flex items-center gap-2">
                  <HandCoins className="size-4 shrink-0 text-warning" />
                  Lançado no fiado de <b>{resumo.cliente}</b>
                </li>
              )}
              {resumo.caixas > 0 && (
                <li className="flex items-center gap-2">
                  <Container className="size-4 shrink-0 text-muted-foreground" />
                  {resumo.caixas} caixa(s) plástica(s) com {resumo.cliente}
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Button size="lg" className="h-14 w-full text-base" onClick={() => setResumo(null)}>
          <ShoppingCart className="size-5" /> Próxima venda
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline">
            <Link href="/vendas">Ver vendas</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={resumo.fiado ? "/fiado" : "/dashboard"}>
              {resumo.fiado ? "Ver fiado" : "Ir para o início"}
            </Link>
          </Button>
        </div>
      </div>
    );
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

      {/* Autocomplete nativo: sem JS extra, funciona em qualquer navegador e
          no teclado do celular. Evita o mesmo cliente virar "João", "joao" e
          "JOÃO" — três saldos separados no fiado e nas caixas. */}
      <datalist id={LISTA_CLIENTES}>
        {clientesConhecidos.map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>

      {payment === "FIADO" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            placeholder="Nome do cliente (fiado)"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            list={LISTA_CLIENTES}
          />
          <div className="flex flex-col gap-1">
            <Input
              type="date"
              aria-label="Vencimento do fiado"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">Vencimento (opcional)</span>
          </div>
        </div>
      ) : (
        usaCaixaPlastica && (
          <Input
            placeholder="Nome do cliente (controle de caixas)"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            list={LISTA_CLIENTES}
          />
        )
      )}

      {/* Caixas plásticas que saem com a mercadoria */}
      <div className="flex flex-col gap-2 rounded-lg border p-3">
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
          <>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              aria-label="Quantidade de caixas plásticas"
              placeholder="Quantidade de caixas"
              value={crateQty}
              onChange={(e) => setCrateQty(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              {caixasLimpas} caixa(s) limpa(s) em estoque.
            </span>
          </>
        )}
      </div>

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
