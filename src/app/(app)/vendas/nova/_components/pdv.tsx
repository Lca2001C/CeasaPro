"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Container,
  HandCoins,
  Loader2,
  Minus,
  Package,
  Plus,
  Repeat,
  Search,
  ShoppingCart,
  Star,
  Trash2,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { formatBRL, formatQty } from "@/lib/format";
import { RECIPIENT_TYPE_LABELS, SALE_UNIT_LABELS, toOptions } from "@/lib/labels";
import { nivelEstoque, passaDoEstoque, saldoApos } from "@/lib/estoque/nivel";
import { useOnline } from "@/lib/pwa/use-online";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";
import { QuantityInput } from "@/components/forms/quantity-input";
import { PhoneInput } from "@/components/forms/phone-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Produto {
  id: string;
  name: string;
  saleUnit: string;
}

interface CartItem {
  productId: string;
  name: string;
  saleUnit: string;
  quantity: number;
  unitPrice: number;
  /** Vasilhame desta linha — uma venda pode misturar plástica e papelão. */
  recipientType: string;
  crateQty: number;
  /** Desconto desta linha, em reais. */
  discountAmount: number;
}

interface Parcela {
  method: "DINHEIRO" | "PIX" | "CARTAO" | "FIADO";
  amount: number;
}

/** id do `<datalist>` que alimenta o autocomplete de cliente. */
const LISTA_CLIENTES = "pdv-clientes-conhecidos";

/** O que a venda mudou no sistema — mostrado na confirmação. */
interface ResumoVenda {
  total: number;
  desconto: number;
  pagamento: string;
  troco: number | null;
  cliente: string | null;
  fiado: number;
  caixas: number;
  baixas: { nome: string; antes: number; depois: number }[];
}

const PAYMENTS = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "PIX", label: "PIX" },
  { value: "CARTAO", label: "Cartão" },
  { value: "FIADO", label: "Fiado" },
] as const;

/** Centavo de tolerância ao conferir a soma das formas de pagamento. */
const TOLERANCIA = 0.005;

const arredonda = (v: number) => Math.round(v * 100) / 100;

export function Pdv({
  produtos,
  caixasLimpas,
  caixasHabilitado = true,
  ultimosPrecos = {},
  precosDaCompra = {},
  maisVendidos = [],
  clientesConhecidos = [],
  estoquePorProduto = {},
  produtoInicial,
  ultimaVenda = null,
}: {
  produtos: Produto[];
  caixasLimpas: number;
  /** O plano inclui o módulo de caixas plásticas? Se não, o bloco não aparece. */
  caixasHabilitado?: boolean;
  /** Último preço vendido por produto — só sugestão, o campo segue editável. */
  ultimosPrecos?: Record<string, number>;
  /** Preço sugerido a partir da última compra, para produto nunca vendido. */
  precosDaCompra?: Record<string, number>;
  /** Ids dos produtos que mais giram (30 dias) — abrem a busca vazia. */
  maisVendidos?: string[];
  /** Clientes já atendidos, para autocompletar e evitar nomes duplicados. */
  clientesConhecidos?: string[];
  /** Saldo em estoque por produto, para avisar ANTES de finalizar. */
  estoquePorProduto?: Record<string, number>;
  /** Produto que veio pelo atalho "Vender" da tela de Estoque. */
  produtoInicial?: string;
  /** Última venda registrada, para o botão "Repetir última venda". */
  ultimaVenda?: {
    customerName: string | null;
    itens: { productId: string; name: string; saleUnit: string; quantity: number; unitPrice: number }[];
  } | null;
}) {
  const router = useRouter();
  const online = useOnline();
  const [search, setSearch] = useState("");
  /** Quantidade usada ao adicionar — acelera "50 caixas de tomate" num toque. */
  const [qtdParaAdicionar, setQtdParaAdicionar] = useState<number | undefined>(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [detalheAberto, setDetalheAberto] = useState<string | null>(null);
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]["value"]>("DINHEIRO");
  const [dividido, setDividido] = useState(false);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [descontoAberto, setDescontoAberto] = useState(false);
  const [descontoTipo, setDescontoTipo] = useState<"valor" | "percentual">("valor");
  const [descontoValor, setDescontoValor] = useState<number | undefined>(undefined);
  const [descontoPercentual, setDescontoPercentual] = useState<number | undefined>(undefined);
  const [descontoMotivo, setDescontoMotivo] = useState("");
  const [recebido, setRecebido] = useState<number | undefined>(undefined);
  const [usaCaixaPlastica, setUsaCaixaPlastica] = useState(false);
  const [crateQty, setCrateQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmarPrecoZero, setConfirmarPrecoZero] = useState(false);
  const [resumo, setResumo] = useState<ResumoVenda | null>(null);

  // Atalho "Vender" do Estoque: começa com o produto já no carrinho.
  const [carrinhoIniciado, setCarrinhoIniciado] = useState(false);
  if (!carrinhoIniciado) {
    setCarrinhoIniciado(true);
    const p = produtoInicial ? produtos.find((x) => x.id === produtoInicial) : undefined;
    if (p) setCart([novoItem(p, 1, precoSugerido(p.id))]);
  }

  /**
   * Preço a sugerir: o último vendido; se nunca foi vendido, o preço de venda
   * lançado na compra (ou custo + margem). Produto novo abria com campo vazio e
   * o operador tinha de lembrar o valor de cabeça.
   */
  function precoSugerido(produtoId: string): number {
    return ultimosPrecos[produtoId] ?? precosDaCompra[produtoId] ?? 0;
  }

  function novoItem(p: Produto, quantity: number, unitPrice: number): CartItem {
    return {
      productId: p.id,
      name: p.name,
      saleUnit: p.saleUnit,
      quantity,
      unitPrice,
      recipientType: "",
      crateQty: 0,
      discountAmount: 0,
    };
  }

  const saldoDe = (produtoId: string) => estoquePorProduto[produtoId] ?? 0;
  const unidadeDe = (saleUnit: string) => (SALE_UNIT_LABELS[saleUnit] ?? "").toLowerCase();
  /** Quilo é o caso em que ±1 não serve: 2,350 kg é o normal, não a exceção. */
  const ehPeso = (saleUnit: string) => saleUnit === "KG";

  /** Itens cuja quantidade passa do que existe em estoque. */
  const semEstoque = cart.filter((i) => passaDoEstoque(saldoDe(i.productId), i.quantity));
  const comPrecoZero = cart.filter((i) => i.unitPrice <= 0);

  const clientesFrequentes = clientesConhecidos.slice(0, 4);

  /**
   * Busca vazia mostra o que MAIS GIRA, não o alfabeto.
   * No balcão quase toda venda é o mesmo punhado de itens; abrir por eles corta
   * digitação em quase toda venda.
   */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return produtos.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 12);
    const topo = maisVendidos
      .map((id) => produtos.find((p) => p.id === id))
      .filter((p): p is Produto => Boolean(p));
    if (topo.length > 0) return topo.slice(0, 12);
    return produtos.slice(0, 8);
  }, [search, produtos, maisVendidos]);

  const mostrandoFavoritos = search.trim() === "" && maisVendidos.length > 0;

  // ── Totais ────────────────────────────────────────────────────────────
  const subtotal = arredonda(cart.reduce((a, i) => a + i.quantity * (i.unitPrice || 0), 0));
  const descontoItens = arredonda(cart.reduce((a, i) => a + (i.discountAmount || 0), 0));
  const aposItens = arredonda(subtotal - descontoItens);
  const descontoVenda = arredonda(
    descontoTipo === "percentual"
      ? (aposItens * (descontoPercentual ?? 0)) / 100
      : (descontoValor ?? 0),
  );
  const total = Math.max(0, arredonda(aposItens - descontoVenda));
  const descontoTotal = arredonda(descontoItens + descontoVenda);

  const somaParcelas = arredonda(parcelas.reduce((a, p) => a + (p.amount || 0), 0));
  const faltaParcelar = arredonda(total - somaParcelas);
  const parcelasValidas = !dividido || Math.abs(faltaParcelar) <= TOLERANCIA;

  const parteFiada = dividido
    ? arredonda(parcelas.filter((p) => p.method === "FIADO").reduce((a, p) => a + p.amount, 0))
    : payment === "FIADO"
      ? total
      : 0;
  const temDinheiro = dividido ? parcelas.some((p) => p.method === "DINHEIRO") : payment === "DINHEIRO";
  const troco = recebido != null && recebido > total ? arredonda(recebido - total) : 0;
  const exigeCliente = parteFiada > 0 || (caixasHabilitado && usaCaixaPlastica);

  // ── Carrinho ──────────────────────────────────────────────────────────
  function addProduct(p: Produto) {
    const qtd = qtdParaAdicionar && qtdParaAdicionar > 0 ? qtdParaAdicionar : 1;
    setCart((c) => {
      const found = c.find((i) => i.productId === p.id);
      if (found) {
        return c.map((i) =>
          i.productId === p.id ? { ...i, quantity: arredonda(i.quantity + qtd) } : i,
        );
      }
      return [...c, novoItem(p, qtd, precoSugerido(p.id))];
    });
    setSearch("");
  }

  function updateItem(id: string, patch: Partial<CartItem>) {
    setCart((c) => c.map((i) => (i.productId === id ? { ...i, ...patch } : i)));
  }
  function removeItem(id: string) {
    setCart((c) => c.filter((i) => i.productId !== id));
  }

  function repetirUltimaVenda() {
    if (!ultimaVenda || ultimaVenda.itens.length === 0) return;
    setCart(
      ultimaVenda.itens.map((i) => ({
        productId: i.productId,
        name: i.name,
        saleUnit: i.saleUnit,
        quantity: i.quantity,
        // Preço: o de hoje, não o da venda antiga — mercadoria do Ceasa muda de
        // preço todo dia, e repetir o valor velho venderia no prejuízo.
        unitPrice: precoSugerido(i.productId) || i.unitPrice,
        recipientType: "",
        crateQty: 0,
        discountAmount: 0,
      })),
    );
    if (ultimaVenda.customerName) setCustomer(ultimaVenda.customerName);
    toast.success("Carrinho preenchido com a última venda. Confira os preços.");
  }

  // ── Pagamento dividido ────────────────────────────────────────────────
  function abrirDivisao() {
    setDividido(true);
    // Primeira parcela já com a forma escolhida e o valor cheio: dividir é
    // então só "tirar um pedaço", em vez de montar tudo de novo.
    setParcelas([{ method: payment, amount: total }]);
  }
  function fecharDivisao() {
    setDividido(false);
    setParcelas([]);
  }
  function setParcela(idx: number, patch: Partial<Parcela>) {
    setParcelas((ps) => ps.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function addParcela() {
    const resto = Math.max(0, faltaParcelar);
    const usadas = new Set(parcelas.map((p) => p.method));
    const proxima = PAYMENTS.find((p) => !usadas.has(p.value))?.value ?? "DINHEIRO";
    setParcelas((ps) => [...ps, { method: proxima, amount: resto }]);
  }
  function removeParcela(idx: number) {
    setParcelas((ps) => ps.filter((_, i) => i !== idx));
  }

  // ── Finalizar ─────────────────────────────────────────────────────────
  function validar(): string | null {
    if (cart.length === 0) return "Adicione ao menos um produto.";
    if (cart.some((i) => i.quantity <= 0)) return "Quantidade inválida.";
    if (cart.some((i) => i.discountAmount > i.quantity * i.unitPrice))
      return "O desconto de um item passou do valor dele.";
    if (descontoVenda > aposItens + TOLERANCIA)
      return "O desconto não pode passar do total da venda.";
    if (dividido && parcelas.length === 0) return "Informe as formas de pagamento.";
    if (!parcelasValidas)
      return `As formas de pagamento somam ${formatBRL(somaParcelas)} e o total é ${formatBRL(total)}.`;
    if (parteFiada > 0 && !customer.trim())
      return "Informe o cliente: parte da venda é fiada.";
    if (caixasHabilitado && usaCaixaPlastica) {
      const caixas = parseInt(crateQty, 10) || 0;
      if (caixas <= 0) return "Informe a quantidade de caixas plásticas.";
      if (!customer.trim()) return "Informe o cliente para controlar as caixas plásticas.";
    }
    if (temDinheiro && recebido != null && recebido > 0 && recebido < total)
      return "O valor recebido é menor que o total da venda.";
    return null;
  }

  async function finalizar(permitirPrecoZero = false) {
    const erro = validar();
    if (erro) return toast.error(erro);

    // Preço zero: bloqueia e pede confirmação explícita. Passava batido e a
    // venda entrava zerada, distorcendo faturamento e lucro sem ninguém ver.
    if (comPrecoZero.length > 0 && !permitirPrecoZero) {
      setConfirmarPrecoZero(true);
      return;
    }

    const caixas = caixasHabilitado && usaCaixaPlastica ? parseInt(crateQty, 10) || 0 : 0;

    setSaving(true);
    const res = await apiPost<{ id: string }>("/api/vendas", {
      customerName: customer.trim() || null,
      customerPhone: phone.trim() || null,
      paymentMethod: dividido ? (parcelas[0]?.method ?? payment) : payment,
      payments: dividido ? parcelas.map((p) => ({ method: p.method, amount: p.amount })) : undefined,
      dueDate: parteFiada > 0 && dueDate ? dueDate : null,
      plasticCrateQty: caixas,
      discountAmount: descontoVenda || undefined,
      discountReason: descontoMotivo.trim() || null,
      amountReceived: temDinheiro && recebido ? recebido : null,
      permitirPrecoZero: permitirPrecoZero || undefined,
      items: cart.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice || 0,
        recipientType: i.recipientType || null,
        crateQty: i.crateQty || 0,
        discountAmount: i.discountAmount || undefined,
      })),
    });
    setSaving(false);
    setConfirmarPrecoZero(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }

    // Resumo do que a venda MUDOU, não só "deu certo": o operador precisa
    // saber que o estoque baixou, que virou fiado ou que as caixas saíram —
    // é a diferença entre confiar no sistema e conferir tudo à mão depois.
    setResumo({
      total,
      desconto: descontoTotal,
      pagamento: dividido
        ? parcelas
            .map((p) => `${PAYMENTS.find((x) => x.value === p.method)?.label}: ${formatBRL(p.amount)}`)
            .join(" · ")
        : (PAYMENTS.find((p) => p.value === payment)?.label ?? payment),
      troco: temDinheiro && recebido ? troco : null,
      cliente: customer.trim() || null,
      fiado: parteFiada,
      caixas,
      baixas: cart.map((i) => ({
        nome: i.name,
        antes: saldoDe(i.productId),
        depois: arredonda(saldoDe(i.productId) - i.quantity),
      })),
    });

    setCart([]);
    setCustomer("");
    setPhone("");
    setDueDate("");
    setUsaCaixaPlastica(false);
    setCrateQty("");
    setPayment("DINHEIRO");
    fecharDivisao();
    setDescontoAberto(false);
    setDescontoValor(undefined);
    setDescontoPercentual(undefined);
    setDescontoMotivo("");
    setRecebido(undefined);
    setQtdParaAdicionar(1);
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
              <p className="text-sm text-muted-foreground">Venda registrada · {resumo.pagamento}</p>
            </div>

            {resumo.troco != null && (
              <p className="w-full rounded-md border border-success/40 bg-background p-2 text-base font-semibold">
                Troco: <span className="tabular-nums">{formatBRL(resumo.troco)}</span>
              </p>
            )}

            <ul className="w-full space-y-1 text-left text-sm">
              {resumo.desconto > 0 && (
                <li className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-muted-foreground" />
                  Desconto concedido: <b>{formatBRL(resumo.desconto)}</b>
                </li>
              )}
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
              {resumo.fiado > 0 && (
                <li className="flex items-center gap-2">
                  <HandCoins className="size-4 shrink-0 text-warning" />
                  <span>
                    <b>{formatBRL(resumo.fiado)}</b> no fiado de <b>{resumo.cliente}</b>
                  </span>
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
            <Link href={resumo.fiado > 0 ? "/fiado" : "/dashboard"}>
              {resumo.fiado > 0 ? "Ver fiado" : "Ir para o início"}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Frente de caixa</h1>

      {/* Sem internet a venda NÃO é registrada — decisão de produto, por causa
          do conflito de estoque. Dizer isso ANTES evita montar o carrinho
          inteiro e descobrir no último toque. */}
      {!online && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <WifiOff className="mt-0.5 size-5 shrink-0" />
          <span>
            <b className="block">Sem internet — a venda não pode ser registrada.</b>
            Nada é perdido: quando a conexão voltar, o carrinho continua aqui. Para conferir
            preço ou saldo agora, use a{" "}
            <Link href="/consulta-offline" className="underline underline-offset-2">
              Consulta offline
            </Link>
            .
          </span>
        </div>
      )}

      {/* 1. QUEM — o cliente vale para qualquer forma de pagamento. */}
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
        {customer.trim() && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pdv-telefone">Telefone (opcional)</Label>
            <PhoneInput id="pdv-telefone" value={phone} onChange={setPhone} />
          </div>
        )}
      </div>

      {ultimaVenda && cart.length === 0 && (
        <Button type="button" variant="outline" onClick={repetirUltimaVenda}>
          <Repeat className="size-4" />
          {ultimaVenda.customerName
            ? `Repetir última venda (${ultimaVenda.customerName})`
            : "Repetir última venda"}
        </Button>
      )}

      {/* 2. O QUÊ */}
      <div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-12 pl-9"
              placeholder="Buscar produto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {/* Quantidade ANTES de adicionar: "50 caixas de tomate" passa a ser um
              toque, em vez de 50 toques no + ou uma correção depois. */}
          <div className="w-24 shrink-0">
            <QuantityInput
              value={qtdParaAdicionar}
              onChange={setQtdParaAdicionar}
              placeholder="Qtd."
              aria-label="Quantidade ao adicionar"
            />
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          A quantidade ao lado é usada ao tocar no produto (pode digitar 2,5 para peso).
        </p>

        {filtered.length > 0 && (
          <>
            {mostrandoFavoritos && (
              <p className="mt-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Star className="size-3" /> Mais vendidos nos últimos 30 dias
              </p>
            )}
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
          </>
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
          {cart.map((i) => {
            const bruto = i.quantity * (i.unitPrice || 0);
            const liquido = Math.max(0, bruto - (i.discountAmount || 0));
            const aberto = detalheAberto === i.productId;
            return (
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
                      Quantidade{unidadeDe(i.saleUnit) ? ` (${unidadeDe(i.saleUnit)})` : ""}
                    </span>
                    {ehPeso(i.saleUnit) ? (
                      // Peso: ±1 kg não serve. Tomate sai a 2,350 kg, e o campo
                      // decimal é o único jeito de registrar isso sem arredondar.
                      <div className="w-28">
                        <QuantityInput
                          value={i.quantity}
                          onChange={(v) => updateItem(i.productId, { quantity: v ?? 0 })}
                          aria-label={`Quantidade de ${i.name}`}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-11"
                          aria-label="Diminuir quantidade"
                          onClick={() =>
                            updateItem(i.productId, {
                              quantity: Math.max(0.001, arredonda(i.quantity - 1)),
                            })
                          }
                        >
                          <Minus className="size-4" />
                        </Button>
                        {/* Digitável também: ± é bom para 1 ou 2, não para 40. */}
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          aria-label={`Quantidade de ${i.name}`}
                          className="h-11 w-16 px-1 text-center tabular-nums"
                          value={i.quantity}
                          onChange={(e) =>
                            updateItem(i.productId, { quantity: Number(e.target.value) || 0 })
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-11"
                          aria-label="Aumentar quantidade"
                          onClick={() =>
                            updateItem(i.productId, { quantity: arredonda(i.quantity + 1) })
                          }
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">Preço da unidade</span>
                    <CurrencyInput
                      value={i.unitPrice}
                      onChange={(v) => updateItem(i.productId, { unitPrice: v ?? 0 })}
                      aria-label={`Preço de ${i.name}`}
                    />
                  </div>
                  <div className="flex flex-col gap-1 text-right">
                    <span className="text-[11px] text-muted-foreground">Total</span>
                    <span className="font-semibold tabular-nums">{formatBRL(liquido)}</span>
                    {i.discountAmount > 0 && (
                      <span className="text-[11px] text-muted-foreground line-through">
                        {formatBRL(bruto)}
                      </span>
                    )}
                  </div>
                </div>

                {i.unitPrice <= 0 && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-warning">
                    <AlertTriangle className="size-3.5 shrink-0" /> Sem preço — a venda sairia
                    zerada
                  </p>
                )}

                {/* Vasilhame e desconto por linha ficam recolhidos: são o caso
                    incomum, e ocupariam a tela toda no celular. */}
                <button
                  type="button"
                  className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground"
                  onClick={() => setDetalheAberto(aberto ? null : i.productId)}
                  aria-expanded={aberto}
                >
                  <ChevronDown className={cn("size-3.5 transition-transform", aberto && "rotate-180")} />
                  Vasilhame e desconto
                  {(i.recipientType || i.discountAmount > 0) && !aberto && (
                    <span className="text-primary">· preenchido</span>
                  )}
                </button>

                {aberto && (
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">Vasilhame</span>
                      <Select
                        value={i.recipientType}
                        onChange={(e) =>
                          updateItem(i.productId, { recipientType: e.target.value })
                        }
                        aria-label={`Vasilhame de ${i.name}`}
                      >
                        <option value="">— Nenhum —</option>
                        {toOptions(RECIPIENT_TYPE_LABELS).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">Qtd. de vasilhames</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        disabled={!i.recipientType}
                        aria-label={`Vasilhames de ${i.name}`}
                        value={i.crateQty || ""}
                        onChange={(e) =>
                          updateItem(i.productId, { crateQty: parseInt(e.target.value, 10) || 0 })
                        }
                      />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">
                        Desconto deste item (R$)
                      </span>
                      <CurrencyInput
                        aria-label={`Desconto de ${i.name}`}
                        value={i.discountAmount}
                        onChange={(v) =>
                          updateItem(i.productId, {
                            discountAmount: Math.min(v ?? 0, arredonda(bruto)),
                          })
                        }
                      />
                    </div>
                  </div>
                )}

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
            );
          })}
        </div>
      )}

      {/* Desconto da venda */}
      {cart.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium"
            onClick={() => setDescontoAberto((v) => !v)}
            aria-expanded={descontoAberto}
          >
            <ChevronDown
              className={cn("size-4 transition-transform", descontoAberto && "rotate-180")}
            />
            Desconto na venda
            {descontoVenda > 0 && (
              <span className="text-primary">· {formatBRL(descontoVenda)}</span>
            )}
          </button>

          {descontoAberto && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Tipo</span>
                  <Select
                    value={descontoTipo}
                    onChange={(e) => setDescontoTipo(e.target.value as "valor" | "percentual")}
                    aria-label="Tipo de desconto"
                  >
                    <option value="valor">Em reais (R$)</option>
                    <option value="percentual">Percentual (%)</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    {descontoTipo === "valor" ? "Valor" : "Percentual"}
                  </span>
                  {descontoTipo === "valor" ? (
                    <CurrencyInput value={descontoValor} onChange={setDescontoValor} />
                  ) : (
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="any"
                      aria-label="Percentual de desconto"
                      value={descontoPercentual ?? ""}
                      onChange={(e) => setDescontoPercentual(Number(e.target.value) || 0)}
                    />
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Motivo (opcional)</span>
                <Input
                  placeholder="Ex.: cliente antigo, mercadoria madura"
                  value={descontoMotivo}
                  onChange={(e) => setDescontoMotivo(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pagamento */}
      {!dividido ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-4 gap-2">
            {PAYMENTS.map((p) => (
              <Button
                key={p.value}
                type="button"
                variant={payment === p.value ? "default" : "outline"}
                onClick={() => setPayment(p.value)}
                className="h-12"
              >
                {p.label}
              </Button>
            ))}
          </div>
          {cart.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={abrirDivisao}>
              Dividir em mais de uma forma
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Pagamento dividido</span>
            <Button type="button" variant="ghost" size="sm" onClick={fecharDivisao}>
              Usar uma só forma
            </Button>
          </div>
          {parcelas.map((p, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <div className="flex-1">
                <Select
                  value={p.method}
                  onChange={(e) => setParcela(idx, { method: e.target.value as Parcela["method"] })}
                  aria-label={`Forma de pagamento ${idx + 1}`}
                >
                  {PAYMENTS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-32">
                <CurrencyInput
                  value={p.amount}
                  onChange={(v) => setParcela(idx, { amount: v ?? 0 })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remover forma de pagamento"
                onClick={() => removeParcela(idx)}
                disabled={parcelas.length === 1}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addParcela}
              disabled={parcelas.length >= 4}
            >
              <Plus className="size-4" /> Adicionar forma
            </Button>
            <span
              className={cn(
                "text-sm tabular-nums",
                parcelasValidas ? "text-muted-foreground" : "font-medium text-destructive",
              )}
            >
              {parcelasValidas
                ? "Fecha com o total"
                : faltaParcelar > 0
                  ? `Falta ${formatBRL(faltaParcelar)}`
                  : `Sobra ${formatBRL(-faltaParcelar)}`}
            </span>
          </div>
        </div>
      )}

      {/* Autocomplete nativo: sem JS extra, funciona em qualquer navegador e
          no teclado do celular. Evita o mesmo cliente virar "João", "joao" e
          "JOÃO" — três saldos separados no fiado e nas caixas. */}
      <datalist id={LISTA_CLIENTES}>
        {clientesConhecidos.map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>

      {/* Troco: some a conta de cabeça no balcão. */}
      {temDinheiro && cart.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total da venda</span>
            <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pdv-recebido">Cliente pagou com</Label>
            <CurrencyInput id="pdv-recebido" value={recebido} onChange={setRecebido} />
          </div>
          {recebido != null && recebido > 0 && (
            <div
              className={cn(
                "flex items-center justify-between rounded-md p-2 text-base",
                recebido < total
                  ? "border border-destructive/40 bg-destructive/10 text-destructive"
                  : "border border-success/40 bg-success/10",
              )}
            >
              <span className="font-medium">{recebido < total ? "Falta" : "Troco"}</span>
              <span className="font-bold tabular-nums">
                {formatBRL(recebido < total ? total - recebido : troco)}
              </span>
            </div>
          )}
        </div>
      )}

      {parteFiada > 0 && (
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

      {exigeCliente && !customer.trim() && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {parteFiada > 0
              ? "Informe o cliente lá em cima — a parte fiada precisa de nome para virar conta a receber."
              : "Informe o cliente lá em cima — as caixas plásticas ficam registradas no nome dele."}
          </span>
        </div>
      )}

      {/* Caixas plásticas só para quem tem o módulo: sem ele o bloco só gerava
          dúvida, e o servidor chegava a barrar a venda por um saldo de caixas
          que a empresa nem controla. */}
      {caixasHabilitado && (
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
      )}

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
          <span className="shrink-0 text-right">
            {descontoTotal > 0 && (
              <span className="block text-xs text-muted-foreground line-through tabular-nums">
                {formatBRL(subtotal)}
              </span>
            )}
            <span className="text-2xl font-bold tabular-nums">{formatBRL(total)}</span>
          </span>
        </div>

        <Button
          size="lg"
          className="h-14 w-full text-base"
          onClick={() => finalizar()}
          disabled={saving || !online}
        >
          {saving && <Loader2 className="animate-spin" />}
          {online ? "Finalizar venda" : "Sem internet"}
        </Button>
      </div>

      <Dialog open={confirmarPrecoZero} onOpenChange={setConfirmarPrecoZero}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar venda com item sem preço?</DialogTitle>
            <DialogDescription>
              {comPrecoZero.map((i) => i.name).join(", ")} {comPrecoZero.length === 1 ? "está" : "estão"}{" "}
              com preço zero. A venda entra valendo {formatBRL(total)} e isso reduz o faturamento e
              o lucro do período. Se foi brinde ou amostra, pode seguir.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Voltar e corrigir</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => finalizar(true)} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Registrar assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
