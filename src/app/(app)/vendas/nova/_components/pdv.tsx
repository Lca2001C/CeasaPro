"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
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
import { formatBRL, formatQty } from "@/lib/format";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import { nivelEstoque, passaDoEstoque, saldoApos } from "@/lib/estoque/nivel";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  pagamento: string;
  cliente: string | null;
  fiado: boolean;
  caixas: number;
  baixas: { nome: string; antes: number; depois: number }[];
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
  estoquePorProduto = {},
  produtoInicial,
}: {
  produtos: Produto[];
  caixasLimpas: number;
  /** Último preço vendido por produto — só sugestão, o campo segue editável. */
  ultimosPrecos?: Record<string, number>;
  /** Clientes já atendidos, para autocompletar e evitar nomes duplicados. */
  clientesConhecidos?: string[];
  /** Saldo em estoque por produto, para avisar ANTES de finalizar. */
  estoquePorProduto?: Record<string, number>;
  /** Produto que veio pelo atalho "Vender" da tela de Estoque. */
  produtoInicial?: string;
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

  // Atalho "Vender" do Estoque: começa com o produto já no carrinho.
  const [carrinhoIniciado, setCarrinhoIniciado] = useState(false);
  if (!carrinhoIniciado) {
    setCarrinhoIniciado(true);
    const p = produtoInicial ? produtos.find((x) => x.id === produtoInicial) : undefined;
    if (p) {
      setCart([
        { productId: p.id, name: p.name, quantity: 1, unitPrice: ultimosPrecos[p.id] ?? 0 },
      ]);
    }
  }

  const saldoDe = (produtoId: string) => estoquePorProduto[produtoId] ?? 0;

  /** Itens cuja quantidade passa do que existe em estoque. */
  const semEstoque = cart.filter((i) => passaDoEstoque(saldoDe(i.productId), i.quantity));

  // Os primeiros da lista já vêm ordenados por nome; pegamos poucos para os
  // chips não competirem com o campo de busca.
  const clientesFrequentes = clientesConhecidos.slice(0, 4);

  const unidadeDe = (produtoId: string) => {
    const p = produtos.find((x) => x.id === produtoId);
    return p ? (SALE_UNIT_LABELS[p.saleUnit] ?? "").toLowerCase() : "";
  };

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
      pagamento: PAYMENTS.find((p) => p.value === payment)?.label ?? payment,
      cliente: customer.trim() || null,
      fiado: payment === "FIADO",
      caixas,
      // Saldo antes → depois, por produto: é o que faz o operador confiar que
      // o estoque foi mesmo atualizado, em vez de conferir na outra aba.
      baixas: cart.map((i) => ({
        nome: i.name,
        antes: saldoDe(i.productId),
        depois: saldoDe(i.productId) - i.quantity,
      })),
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
              {resumo.baixas.map((b) => (
                <li key={b.nome} className="flex items-center gap-2">
                  <Package className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    Estoque baixado — <b>{b.nome}</b>:{" "}
                    <span className="tabular-nums">
                      {formatQty(b.antes)} → {formatQty(b.depois)}
                    </span>
                  </span>
                </li>
              ))}
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

      {/* 1. QUEM — o cliente vem primeiro e vale para qualquer forma de
          pagamento. Antes o campo só aparecia no fiado ou com caixa plástica,
          então venda à vista ficava sem nome e o histórico sem dono. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pdv-cliente">Cliente (opcional)</Label>
        <Input
          id="pdv-cliente"
          className="h-12"
          placeholder="Nome do cliente"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          list={LISTA_CLIENTES}
        />
        {clientesFrequentes.length > 0 && !customer && (
          <div className="flex flex-wrap gap-1.5">
            {clientesFrequentes.map((nome) => (
              <Button
                key={nome}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCustomer(nome)}
              >
                {nome}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* 2. O QUÊ */}
      <div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-12 pl-9"
            placeholder="Buscar produto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        {filtered.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {filtered.map((p) => {
              const saldo = saldoDe(p.id);
              const nivel = nivelEstoque(saldo);
              return (
                <Button
                  key={p.id}
                  variant="outline"
                  // Alvo de toque maior: mão molhada, dedo grosso, tela pequena.
                  className={cn(
                    "h-auto min-h-14 flex-col items-start gap-0.5 px-3 py-2",
                    nivel === "acabando" && "border-warning/60",
                    nivel === "zerado" && "opacity-60",
                  )}
                  onClick={() => addProduct(p)}
                  type="button"
                >
                  <span className="flex items-center gap-1 font-medium">
                    <Plus className="size-4" /> {p.name}
                  </span>
                  {/* O saldo aqui evita descobrir que faltou mercadoria só no
                      erro do servidor, com o cliente esperando. */}
                  <span
                    className={cn(
                      "text-xs",
                      nivel === "acabando"
                        ? "text-warning"
                        : nivel === "zerado"
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                  >
                    {nivel === "zerado"
                      ? "sem estoque"
                      : `${formatQty(saldo)} ${SALE_UNIT_LABELS[p.saleUnit]}${
                          nivel === "acabando" ? " · acabando" : ""
                        }`}
                  </span>
                </Button>
              );
            })}
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
              {/* Rótulos explícitos: sem eles é fácil digitar o preço no campo
                  da quantidade e só perceber no total. */}
              <div className="mt-2 grid grid-cols-[auto_1fr_6rem] items-end gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    Quantidade{unidadeDe(i.productId) ? ` (${unidadeDe(i.productId)})` : ""}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11"
                      aria-label="Diminuir quantidade"
                      onClick={() =>
                        updateItem(i.productId, { quantity: Math.max(0.001, i.quantity - 1) })
                      }
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-10 text-center font-medium tabular-nums">
                      {i.quantity}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11"
                      aria-label="Aumentar quantidade"
                      onClick={() => updateItem(i.productId, { quantity: i.quantity + 1 })}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Preço da unidade</span>
                  <CurrencyInput
                    value={i.unitPrice}
                    onChange={(v) => updateItem(i.productId, { unitPrice: v ?? 0 })}
                  />
                </div>
                <div className="flex flex-col gap-1 text-right">
                  <span className="text-[11px] text-muted-foreground">Total</span>
                  <span className="font-semibold tabular-nums">
                    {formatBRL(i.quantity * (i.unitPrice || 0))}
                  </span>
                </div>
              </div>

              {/* Saldo antes → depois, na linha do item. */}
              <p
                className={cn(
                  "mt-1.5 text-xs",
                  passaDoEstoque(saldoDe(i.productId), i.quantity)
                    ? "font-medium text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {passaDoEstoque(saldoDe(i.productId), i.quantity) ? (
                  <>
                    Só tem {formatQty(saldoDe(i.productId))} — você está vendendo{" "}
                    {formatQty(i.quantity)}
                  </>
                ) : (
                  <>
                    Em estoque: {formatQty(saldoDe(i.productId))} → ficará{" "}
                    {formatQty(saldoApos(saldoDe(i.productId), i.quantity))}
                  </>
                )}
              </p>
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

      {/* O nome do cliente agora está no topo, para qualquer forma de
          pagamento — aqui fica só o que é específico do fiado. Fiado e caixa
          plástica EXIGEM cliente; o aviso aparece quando ele está vazio. */}
      {payment === "FIADO" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pdv-vencimento">Vencimento do fiado (opcional)</Label>
          <Input
            id="pdv-vencimento"
            type="date"
            className="h-12"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      )}

      {(payment === "FIADO" || usaCaixaPlastica) && !customer.trim() && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {payment === "FIADO"
              ? "Informe o cliente lá em cima — venda fiada precisa de nome para virar conta a receber."
              : "Informe o cliente lá em cima — as caixas plásticas ficam registradas no nome dele."}
          </span>
        </div>
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
        {semEstoque.length > 0 && (
          // Aviso ANTES do clique. A validação de verdade continua no servidor;
          // aqui o objetivo é o operador não descobrir a falta com o cliente na
          // frente, depois de já ter fechado o valor.
          <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              {semEstoque.map((i) => (
                <span key={i.productId} className="block">
                  <b>{i.name}</b>: só tem {formatQty(saldoDe(i.productId))}, vendendo{" "}
                  {formatQty(i.quantity)}
                </span>
              ))}
            </span>
          </div>
        )}

        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {customer.trim() ? (
              <>
                Vendendo para <b className="text-foreground">{customer.trim()}</b>
              </>
            ) : (
              "Venda avulsa"
            )}
            {cart.length > 0 && ` · ${cart.length} produto(s)`}
          </span>
          <span className="shrink-0 text-2xl font-bold tabular-nums">{formatBRL(total)}</span>
        </div>

        <Button
          size="lg"
          className="h-14 w-full text-base"
          onClick={finalizar}
          disabled={saving}
        >
          {saving && <Loader2 className="animate-spin" />}
          Finalizar venda
        </Button>
      </div>
    </div>
  );
}
