"use client";

import { memo, useCallback, useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  Check,
  CheckCircle2,
  ChevronDown,
  Container,
  CreditCard,
  HandCoins,
  Loader2,
  Minus,
  Package,
  Plus,
  QrCode,
  Repeat,
  Search,
  ShoppingCart,
  Star,
  Trash2,
  WifiOff,
  Clock,
  PackageCheck,
} from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { formatBRL, formatQty } from "@/lib/format";
import { RECIPIENT_TYPE_LABELS, SALE_UNIT_LABELS, toOptions } from "@/lib/labels";
import { nivelEstoque, passaDoEstoque, saldoApos } from "@/lib/estoque/nivel";
import { nomeDaEmbalagem } from "@/lib/estoque/custo-carga";
import { agruparPorPrimeiraPalavra, primeiraPalavra } from "@/lib/cotacoes/nome";
import { embalagemCasaComVenda } from "@/lib/cotacoes/embalagem-texto";
import type { ReferenciaDoBoletim } from "@/lib/services/cotacoes.service";
import type { SaleUnit } from "@prisma/client";
import {
  calcularTotaisVenda,
  centsParaNumero,
  paraCentavos,
  somaParcelasCents,
  TOLERANCIA_CENTAVOS_BIG,
} from "@/lib/venda/total";
import { useOnline } from "@/lib/pwa/use-online";
import {
  caixasPlasticasDaVenda,
  descontoMaximoDoItemCents,
  mensagemDoErro,
  normalizarBusca,
  somarQuantidade,
  subtrairQuantidade,
} from "./pdv-regras";
import { cn } from "@/lib/cn";
import { EVENTO_ATUALIZAR_NOTIFICACOES } from "@/components/layout/sino-notificacoes";
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
  /** Alerta de estoque do produto — o mesmo "acabando" da tela de Estoque. */
  minStock?: number | null;
  /** Foto do produto (bucket público). `null` = mostra o ícone. */
  imageUrl?: string | null;
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
  cliente: string | null;
  fiado: number;
  caixas: number;
  baixas: { nome: string; antes: number; depois: number }[];
}

const PAYMENTS = [
  { value: "DINHEIRO", label: "Dinheiro", icone: Banknote },
  { value: "PIX", label: "PIX", icone: QrCode },
  { value: "CARTAO", label: "Cartão", icone: CreditCard },
  { value: "FIADO", label: "Fiado", icone: HandCoins },
] as const;

/** Filtros fixos da grade; os demais são as famílias (primeira palavra do nome). */
const TODOS = "__todos__";
const MAIS_VENDIDOS = "__mais_vendidos__";

/*
 * Nem dinheiro nem quantidade passam por ponto flutuante nesta tela: os totais
 * vêm de `lib/venda/total` (o contrato que a validação e o serviço executam) e
 * as somas de quantidade de `./pdv-regras`, em milésimos inteiros. O antigo
 * `arredonda` de 2 casas cortava a terceira casa do quilo (2,345 + 1,25 = 3,6).
 *
 * Layout: até `lg` a tela é uma coluna (cliente → produtos → carrinho →
 * pagamento) com o total fixo no rodapé do celular; do `lg` para cima, o
 * pedido e o pagamento viram uma coluna à direita, que acompanha a rolagem.
 */
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
  boletim = {},
  ultimosPagos = {},
}: {
  produtos: Produto[];
  caixasLimpas: number;
  /** O plano inclui o módulo de caixas plásticas? Se não, o bloco não aparece. */
  caixasHabilitado?: boolean;
  /** Último preço vendido por produto — só sugestão, o campo segue editável. */
  ultimosPrecos?: Record<string, number>;
  /** Preço sugerido a partir da última compra, para produto nunca vendido. */
  precosDaCompra?: Record<string, number>;
  /** Ids dos produtos que mais giram (30 dias) — vêm primeiro na grade. */
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
  /**
   * Boletim do produto vinculado. Vazio quando o plano não inclui Cotações.
   *
   * SOMENTE LEITURA, e nunca entra em `precoSugerido`. O boletim é o preço que
   * o dono do box PAGA na praça; o preço do balcão é dele. Um módulo de consulta
   * mexendo no valor de uma venda seria trocar informação por decisão.
   */
  boletim?: Record<string, ReferenciaDoBoletim>;
  /** Último preço pago por produto (sem frete), para a margem ficar visível. */
  ultimosPagos?: Record<string, { unitPrice: number; purchaseDate: string | Date }>;
}) {
  const router = useRouter();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<string>(TODOS);
  /** Quantidade usada ao adicionar — acelera "50 caixas de tomate" num toque. */
  const [qtdParaAdicionar, setQtdParaAdicionar] = useState<number | undefined>(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [detalheAberto, setDetalheAberto] = useState<string | null>(null);
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]["value"]>("DINHEIRO");
  const [dividido, setDividido] = useState(false);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [customer, setCustomer] = useState("");
  /**
   * O cliente leva agora ou busca depois? Começa SEM escolha de propósito: é
   * obrigatória, e um padrão pré-marcado viraria "leva agora" por descuido —
   * a mercadoria separada no box ficaria sem dono na lista de retiradas.
   */
  const [retirarDepois, setRetirarDepois] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [descontoAberto, setDescontoAberto] = useState(false);
  const [descontoTipo, setDescontoTipo] = useState<"valor" | "percentual">("valor");
  const [descontoValor, setDescontoValor] = useState<number | undefined>(undefined);
  const [descontoPercentual, setDescontoPercentual] = useState<number | undefined>(undefined);
  const [descontoMotivo, setDescontoMotivo] = useState("");
  const [usaCaixaPlastica, setUsaCaixaPlastica] = useState(false);
  const [crateQty, setCrateQty] = useState("");
  const [saving, setSaving] = useState(false);
  /**
   * A pessoa já tentou finalizar pelo menos uma vez?
   *
   * Guarda a TENTATIVA, e não a mensagem. A mensagem é derivada de `validar()`
   * na renderização, o que dá duas coisas de graça: ela se corrige sozinha
   * conforme o carrinho muda (guardar o texto deixaria um aviso velho na tela
   * depois de o problema ter sido resolvido), e ela não aparece antes da
   * primeira tentativa — cobrar campo que a pessoa ainda nem chegou a
   * preencher é o jeito mais rápido de ensinar a ignorar aviso vermelho.
   */
  const [jaTentouFinalizar, setJaTentouFinalizar] = useState(false);
  const [confirmarPrecoZero, setConfirmarPrecoZero] = useState(false);
  const [resumo, setResumo] = useState<ResumoVenda | null>(null);
  /** Chave de idempotência do carrinho atual — ver o uso em `finalizar`. */
  const chaveDoCarrinho = useRef<string | null>(null);

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

  const saldoDe = (produtoId: string) => estoquePorProduto[produtoId] ?? 0;
  const unidadeDe = (saleUnit: string) => (SALE_UNIT_LABELS[saleUnit] ?? "").toLowerCase();
  /** Quilo é o caso em que ±1 não serve: 2,350 kg é o normal, não a exceção. */
  const ehPeso = (saleUnit: string) => saleUnit === "KG";
  const fotoDe = useMemo(
    () => new Map(produtos.map((p) => [p.id, p.imageUrl ?? null])),
    [produtos],
  );

  /** Itens cuja quantidade passa do que existe em estoque. */
  const semEstoque = cart.filter((i) => passaDoEstoque(saldoDe(i.productId), i.quantity));
  const comPrecoZero = cart.filter((i) => i.unitPrice <= 0);

  const clientesFrequentes = clientesConhecidos.slice(0, 4);

  // ── Grade de produtos ─────────────────────────────────────────────────
  const familias = useMemo(() => agruparPorPrimeiraPalavra(produtos, (p) => p.name), [produtos]);
  const destaque = useMemo(() => new Set(maisVendidos.slice(0, 3)), [maisVendidos]);

  /**
   * O que mais gira vem primeiro, não o alfabeto: no balcão quase toda venda é
   * o mesmo punhado de itens, e abrir por eles corta rolagem em quase toda venda.
   */
  /*
    Busca ADIADA e nomes normalizados uma vez só.

    Cada tecla na busca re-renderizava a tela inteira e normalizava (NFD +
    regex) o nome de todos os produtos de novo. Agora o campo responde na hora
    e a grade filtra logo depois (`useDeferredValue`), com os nomes já
    normalizados; os cartões são `memo`, então só os que mudam redesenham.
  */
  const buscaAdiada = useDeferredValue(search);
  const nomesNormalizados = useMemo(
    () => new Map(produtos.map((p) => [p.id, normalizarBusca(p.name)])),
    [produtos],
  );
  const listados = useMemo(() => {
    const ordem = new Map(maisVendidos.map((id, i) => [id, i]));
    const porId = new Map(produtos.map((p) => [p.id, p]));
    let base: Produto[];
    if (filtro === MAIS_VENDIDOS) {
      base = maisVendidos
        .map((id) => porId.get(id))
        .filter((p): p is Produto => Boolean(p));
    } else if (filtro === TODOS) {
      base = [...produtos].sort(
        (a, b) => (ordem.get(a.id) ?? Infinity) - (ordem.get(b.id) ?? Infinity),
      );
    } else {
      base = produtos.filter((p) => primeiraPalavra(p.name) === filtro);
    }
    const q = normalizarBusca(buscaAdiada);
    return q ? base.filter((p) => (nomesNormalizados.get(p.id) ?? "").includes(q)) : base;
  }, [buscaAdiada, filtro, produtos, maisVendidos, nomesNormalizados]);

  // ── Totais ────────────────────────────────────────────────────────────
  // Os totais vêm do contrato compartilhado — a MESMA função que o refine do
  // Zod e o serviço executam. Somar em ponto flutuante aqui era o que fazia a
  // tela mostrar R$ 2,23 numa venda gravada como R$ 2,24.
  const itensParaTotal = cart.map((i) => ({
    quantity: i.quantity,
    unitPrice: i.unitPrice || 0,
    discountAmount: i.discountAmount || 0,
  }));
  const semDescontoDaVenda = calcularTotaisVenda({ items: itensParaTotal });
  const subtotal = centsParaNumero(semDescontoDaVenda.subtotalCents);
  const descontoItens = centsParaNumero(
    cart.reduce((a, i) => a + paraCentavos(i.discountAmount || 0), 0n),
  );
  // Percentual em centavos inteiros, com meio-para-cima: truncar deixaria o
  // desconto um centavo menor do que o anunciado na tela.
  const descontoVenda =
    descontoTipo === "percentual"
      ? centsParaNumero(
          (semDescontoDaVenda.totalCents * BigInt(Math.round((descontoPercentual ?? 0) * 100)) +
            5_000n) /
            10_000n,
        )
      : (descontoValor ?? 0);
  const totais = calcularTotaisVenda({ items: itensParaTotal, discountAmount: descontoVenda });
  const total = centsParaNumero(totais.totalCents);
  const descontoTotal = centsParaNumero(
    descontoItens === 0 && descontoVenda === 0
      ? 0n
      : paraCentavos(descontoItens) + paraCentavos(descontoVenda),
  );

  const parcelasDaVenda = dividido
    ? parcelas.map((p) => ({ method: p.method, amount: p.amount || 0 }))
    : undefined;
  const somaParcelasEmCents = somaParcelasCents(parcelasDaVenda);
  const somaParcelas = centsParaNumero(somaParcelasEmCents);
  const faltaParcelar = centsParaNumero(totais.totalCents - somaParcelasEmCents);
  const diferencaParcelas = totais.totalCents - somaParcelasEmCents;
  const parcelasValidas =
    !dividido ||
    (diferencaParcelas < 0n ? -diferencaParcelas : diferencaParcelas) <= TOLERANCIA_CENTAVOS_BIG;

  const parteFiada = dividido
    ? centsParaNumero(
        parcelas.filter((p) => p.method === "FIADO").reduce((a, p) => a + paraCentavos(p.amount), 0n),
      )
    : payment === "FIADO"
      ? total
      : 0;

  // Caixas plásticas como o SERVIDOR as resolve: o número do checkbox ou, sem
  // ele, a soma das linhas com vasilhame "Caixa plástica". Olhar só o checkbox
  // deixava passar a venda que o servidor recusa por falta de cliente. Sem o
  // módulo de caixas o servidor descarta as caixas, e a regra não vale.
  const caixasDoCheckbox = caixasHabilitado && usaCaixaPlastica ? parseInt(crateQty, 10) || 0 : 0;
  const caixasResolvidas = caixasHabilitado ? caixasPlasticasDaVenda(caixasDoCheckbox, cart) : 0;
  const exigeCliente =
    parteFiada > 0 || (caixasHabilitado && usaCaixaPlastica) || caixasResolvidas > 0;

  // ── Carrinho ──────────────────────────────────────────────────────────
  // Estável entre teclas da busca (só muda com a quantidade ou os preços), para
  // os cartões `memo` da grade não redesenharem à toa. O preço é o mesmo de
  // `precoSugerido`, escrito aqui para não depender de função recriada a cada render.
  const addProduct = useCallback(
    (p: Produto) => {
      const qtd = qtdParaAdicionar && qtdParaAdicionar > 0 ? qtdParaAdicionar : 1;
      const preco = ultimosPrecos[p.id] ?? precosDaCompra[p.id] ?? 0;
      setCart((c) => {
        const found = c.find((i) => i.productId === p.id);
        if (found) {
          return c.map((i) =>
            i.productId === p.id ? { ...i, quantity: somarQuantidade(i.quantity, qtd) } : i,
          );
        }
        return [...c, novoItem(p, qtd, preco)];
      });
      setSearch("");
    },
    [qtdParaAdicionar, ultimosPrecos, precosDaCompra],
  );
  /** +1 no cartão da grade — pela quantidade ATUAL do carrinho, não a do último render. */
  const porUm = useCallback((item: CartItem) => {
    setCart((c) =>
      c.map((i) =>
        i.productId === item.productId ? { ...i, quantity: somarQuantidade(i.quantity, 1) } : i,
      ),
    );
  }, []);
  /** −1 no cartão da grade; chegando a zero, o item sai (mesma regra de `tirarUm`). */
  const tirarUmDaGrade = useCallback((item: CartItem) => {
    setCart((c) => {
      const atual = c.find((i) => i.productId === item.productId);
      if (!atual) return c;
      const nova = subtrairQuantidade(atual.quantity, 1);
      return nova <= 0
        ? c.filter((i) => i.productId !== item.productId)
        : c.map((i) => (i.productId === item.productId ? { ...i, quantity: nova } : i));
    });
  }, []);

  function updateItem(id: string, patch: Partial<CartItem>) {
    setCart((c) => c.map((i) => (i.productId === id ? { ...i, ...patch } : i)));
  }
  function removeItem(id: string) {
    setCart((c) => c.filter((i) => i.productId !== id));
  }
  /** −1 no cartão ou na linha: chegando a zero, o item SAI do carrinho. */
  function tirarUm(item: CartItem) {
    // O clamp em 0,001 deixava um item fantasma de R$ 0,00 na venda: no visor
    // de 16px do celular, "0,001" e "1" são indistinguíveis, e "−" no último
    // item é o gesto natural de quem quer tirar o produto.
    const nova = subtrairQuantidade(item.quantity, 1);
    if (nova <= 0) removeItem(item.productId);
    else updateItem(item.productId, { quantity: nova });
  }

  function repetirUltimaVenda() {
    if (!ultimaVenda || ultimaVenda.itens.length === 0) return;
    // Só o que ainda está à venda: produto inativado ou excluído depois da
    // última venda faria o servidor recusar tudo com um erro que não diz qual
    // item é — com o cliente esperando no balcão.
    const ativos = new Set(produtos.map((p) => p.id));
    const disponiveis = ultimaVenda.itens.filter((i) => ativos.has(i.productId));
    const foraDeVenda = ultimaVenda.itens
      .filter((i) => !ativos.has(i.productId))
      .map((i) => i.name)
      .join(", ");
    if (disponiveis.length === 0) {
      toast.error(`Nenhum produto da última venda está mais ativo (${foraDeVenda}).`);
      return;
    }
    setCart(
      disponiveis.map((i) => ({
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
    if (foraDeVenda) {
      toast.warning(
        `Carrinho preenchido com a última venda, sem ${foraDeVenda} (não está mais ativo). Confira os preços.`,
      );
    } else {
      toast.success("Carrinho preenchido com a última venda. Confira os preços.");
    }
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
    if (cart.some((i) => paraCentavos(i.discountAmount || 0) > descontoMaximoDoItemCents(i)))
      return "O desconto de um item passou do valor dele.";
    if (paraCentavos(descontoVenda) > semDescontoDaVenda.totalCents + TOLERANCIA_CENTAVOS_BIG)
      return "O desconto não pode passar do total da venda.";
    if (dividido && parcelas.length === 0) return "Informe as formas de pagamento.";
    // O servidor exige valor POSITIVO em cada forma; "Adicionar forma" com o
    // total já fechado cria uma de R$ 0,00.
    if (dividido && parcelas.some((p) => paraCentavos(p.amount || 0) <= 0n))
      return "Informe o valor de cada forma de pagamento (ou remova a que ficou zerada).";
    if (!parcelasValidas)
      return `As formas de pagamento somam ${formatBRL(somaParcelas)} e o total é ${formatBRL(total)}.`;
    if (retirarDepois === null)
      return "Informe se o cliente leva agora ou vai buscar mais tarde.";
    if (retirarDepois && !customer.trim())
      return "Informe o nome do cliente que vai buscar mais tarde.";
    if (parteFiada > 0 && !customer.trim())
      return "Informe o cliente: parte da venda é fiada.";
    if (caixasHabilitado && usaCaixaPlastica) {
      const caixas = parseInt(crateQty, 10) || 0;
      if (caixas <= 0) return "Informe a quantidade de caixas plásticas.";
      if (!customer.trim()) return "Informe o cliente para controlar as caixas plásticas.";
    }
    // Vasilhame "Caixa plástica" na linha, sem o checkbox: o servidor soma as
    // linhas e exige cliente do mesmo jeito.
    if (caixasResolvidas > 0 && !customer.trim())
      return "Informe o cliente para controlar as caixas plásticas.";
    return null;
  }

  async function finalizar(permitirPrecoZero = false) {
    const erro = validar();
    /*
      O erro aparece em DOIS lugares, e não é redundância.

      O toast é `position="top-center"` (ver `ui/sonner.tsx`) e o botão
      "Finalizar venda" é uma barra FIXA no rodapé do celular. O dedo está
      embaixo e o aviso nasce no extremo oposto da tela — com a lista rolada,
      ele pode aparecer fora do campo de visão. A mensagem inline resolve isso
      sem tirar o toast.
    */
    setJaTentouFinalizar(true);
    if (erro) return toast.error(erro);

    // Preço zero: bloqueia e pede confirmação explícita. Passava batido e a
    // venda entrava zerada, distorcendo faturamento e lucro sem ninguém ver.
    if (comPrecoZero.length > 0 && !permitirPrecoZero) {
      setConfirmarPrecoZero(true);
      return;
    }

    const caixas = caixasDoCheckbox;

    setSaving(true);
    // Uma chave por CARRINHO, criada no primeiro envio e mantida enquanto este
    // carrinho existir. É ela que faz a retentativa devolver a venda original
    // em vez de registrar outra — e ela não pode ser derivada do conteúdo do
    // carrinho, porque no balcão duas vendas idênticas em sequência (mesmo
    // cliente, mesmos 10 kg de tomate) são corriqueiras e recusá-las seria
    // recusar dinheiro real.
    chaveDoCarrinho.current ??= crypto.randomUUID();
    const res = await apiPost<{ id: string; jaRegistrada: boolean; totalAmount: string }>("/api/vendas", {
      idempotencyKey: chaveDoCarrinho.current,
      customerName: customer.trim() || null,
      customerPhone: phone.trim() || null,
      retirarDepois: retirarDepois ?? undefined,
      paymentMethod: dividido ? (parcelas[0]?.method ?? payment) : payment,
      payments: dividido ? parcelas.map((p) => ({ method: p.method, amount: p.amount })) : undefined,
      dueDate: parteFiada > 0 && dueDate ? dueDate : null,
      // Zero é "não informado", não "nenhuma caixa". Mandando 0 explícito, o
      // servidor apagava as caixas que o operador declarou linha a linha, no
      // seletor de vasilhame — elas saíam do box sem movimento nenhum.
      plasticCrateQty: caixas > 0 ? caixas : undefined,
      discountAmount: descontoVenda || undefined,
      discountReason: descontoMotivo.trim() || null,
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
      // A chave de idempotência é MANTIDA no erro: nada foi gravado, e o
      // operador vai corrigir o mesmo carrinho e tentar de novo. Se por acaso a
      // venda tiver sido gravada e só a resposta ter se perdido, a repetição
      // com a mesma chave devolve a venda original em vez de criar outra.
      // Falha de schema vem como "Dados inválidos", com o motivo em `fields`.
      toast.error(mensagemDoErro(res.error));
      return;
    }

    // Deu certo: a partir daqui o próximo carrinho é uma venda NOVA.
    chaveDoCarrinho.current = null;

    if (
      res.data.jaRegistrada &&
      BigInt(Math.round(Number(res.data.totalAmount) * 100)) !== totais.totalCents
    ) {
      // A chave era de um envio que deu timeout MAS foi gravado, e o carrinho
      // mudou desde então (mais um item, ou já é o do próximo cliente). Limpar
      // e dizer "nada foi duplicado" engolia esta venda: ela nunca era lançada.
      // O carrinho fica, a chave já foi zerada acima, e o operador decide.
      toast.warning(
        `A venda anterior (${formatBRL(Number(res.data.totalAmount))}) já tinha sido ` +
          "registrada. Este carrinho é diferente e AINDA NÃO foi lançado: confira os itens " +
          "e toque em Finalizar para lançá-lo como venda nova.",
        { duration: 12_000 },
      );
      return;
    }

    if (res.data.jaRegistrada) {
      // Retentativa de uma venda que já estava gravada. Não dá para mostrar o
      // resumo daqui: os números viriam do carrinho atual, e a venda gravada
      // pode ser outra. Melhor levar o operador para a venda de verdade.
      toast.success("Esta venda já havia sido registrada — nada foi duplicado.");
      setCart([]);
      setJaTentouFinalizar(false);
      router.push(`/vendas/${res.data.id}`);
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
      cliente: customer.trim() || null,
      fiado: parteFiada,
      caixas,
      baixas: cart.map((i) => ({
        nome: i.name,
        antes: saldoDe(i.productId),
        depois: subtrairQuantidade(saldoDe(i.productId), i.quantity),
      })),
    });

    // O sino relê: uma venda "Busca depois" vira aviso na hora.
    window.dispatchEvent(new Event(EVENTO_ATUALIZAR_NOTIFICACOES));
    setCart([]);
    // Venda nova começa sem aviso vermelho: a tentativa era do carrinho que
    // acabou de ser gravado.
    setJaTentouFinalizar(false);
    setCustomer("");
    setPhone("");
    setRetirarDepois(null);
    setDueDate("");
    setUsaCaixaPlastica(false);
    setCrateQty("");
    setPayment("DINHEIRO");
    fecharDivisao();
    setDescontoAberto(false);
    setDescontoValor(undefined);
    setDescontoPercentual(undefined);
    setDescontoMotivo("");
    setQtdParaAdicionar(1);
    router.refresh();
  }

  // Confirmação toma a tela inteira de propósito: no balcão, um toast some
  // antes de o operador levantar os olhos.
  if (resumo) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
            <CheckCircle2 className="size-12 text-success" />
            <div>
              <p className="text-2xl font-bold tabular-nums text-success">
                {formatBRL(resumo.total)}
              </p>
              <p className="text-sm text-muted-foreground">Venda registrada · {resumo.pagamento}</p>
            </div>

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

        <Button
          size="lg"
          className="h-14 w-full text-base"
          onClick={() => {
            setResumo(null);
            setJaTentouFinalizar(false);
          }}
        >
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

  // Ver `jaTentouFinalizar`: a mensagem sai de `validar()` a cada render, então
  // some no instante em que a causa é resolvida.
  const erroVisivel = jaTentouFinalizar ? validar() : null;
  const noCarrinho = new Map(cart.map((i) => [i.productId, i]));
  const unidades = cart.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Nova venda</h1>
          <p className="text-sm text-muted-foreground">Atendimento no balcão</p>
        </div>
        {ultimaVenda && cart.length === 0 && (
          <Button type="button" variant="outline" size="sm" onClick={repetirUltimaVenda}>
            <Repeat className="size-4" />
            {ultimaVenda.customerName
              ? `Repetir última venda (${ultimaVenda.customerName})`
              : "Repetir última venda"}
          </Button>
        )}
      </div>

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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_25rem]">
        {/* ── Coluna da esquerda: quem compra e o que compra ─────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          <Etapa numero={1} titulo="Cliente" dica="Opcional — obrigatório no fiado e nas caixas plásticas">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pdv-cliente" className="sr-only">
                Cliente (opcional)
              </Label>
              <Input
                id="pdv-cliente"
                className="h-12"
                placeholder="Nome do cliente"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                list={LISTA_CLIENTES}
                // O servidor recusa nome acima de 120 caracteres.
                maxLength={120}
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
          </Etapa>

          <Etapa numero={2} titulo="Monte o pedido" dica="Toque nos produtos para adicionar ao carrinho">
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-12 pl-9"
                    placeholder="Buscar produto..."
                    aria-label="Buscar produto"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                {/* Quantidade ANTES de adicionar: "50 caixas de tomate" passa a ser um
                    toque, em vez de 50 toques no + ou uma correção depois. */}
                <div className="w-20 shrink-0 sm:w-24">
                  <QuantityInput
                    value={qtdParaAdicionar}
                    onChange={setQtdParaAdicionar}
                    placeholder="Qtd."
                    aria-label="Quantidade ao adicionar"
                  />
                </div>
              </div>
              <p className="-mt-1 text-[11px] text-muted-foreground">
                A quantidade ao lado é usada ao tocar no produto (pode digitar 2,5 para peso).
              </p>

              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar produtos">
                <Filtro ativo={filtro === TODOS} onClick={() => setFiltro(TODOS)}>
                  Todos
                </Filtro>
                {maisVendidos.length > 0 && (
                  <Filtro ativo={filtro === MAIS_VENDIDOS} onClick={() => setFiltro(MAIS_VENDIDOS)}>
                    <Star className="size-3" /> Mais vendidos
                  </Filtro>
                )}
                {familias.length > 1 &&
                  familias.map((f) => (
                    <Filtro key={f.chave} ativo={filtro === f.chave} onClick={() => setFiltro(f.chave)}>
                      {f.rotulo}
                    </Filtro>
                  ))}
              </div>

              {listados.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {search.trim()
                    ? "Nenhum produto com esse nome."
                    : "Nenhum produto ativo para vender. Cadastre no Estoque."}
                </p>
              ) : (
                // A coluna muda de largura com o carrinho ao lado: quem decide quantos
                // cartões cabem é a largura dela, não a da janela.
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:gap-3">
                  {listados.map((p) => (
                    <CartaoDeProduto
                      key={p.id}
                      produto={p}
                      saldo={saldoDe(p.id)}
                      preco={precoSugerido(p.id)}
                      maisVendido={destaque.has(p.id)}
                      item={noCarrinho.get(p.id)}
                      onAdicionar={addProduct}
                      onTirarUm={tirarUmDaGrade}
                      onPorUm={porUm}
                    />
                  ))}
                </div>
              )}
            </div>
          </Etapa>
        </div>

        {/* ── Coluna da direita: o pedido e como ele é pago ──────────────── */}
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
          <Etapa
            numero={3}
            titulo="Carrinho"
            dica={
              unidades === 0
                ? "Nenhum produto ainda"
                : `${unidades} ${unidades === 1 ? "produto" : "produtos"}`
            }
          >
            {cart.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center text-sm text-muted-foreground">
                <ShoppingCart className="size-8" />
                Toque em um produto para adicionar à venda.
              </div>
            ) : (
              <div className="flex flex-col divide-y">
                {cart.map((i, idx) => {
                  // Mesmo contrato do rodapé e do servidor: em float, 2,010 × 1,50
                  // aparecia R$ 3,01 na linha e era cobrado R$ 3,02.
                  const bruto = centsParaNumero(semDescontoDaVenda.brutosCents[idx] ?? 0n);
                  const liquidoCents = semDescontoDaVenda.lineTotalsCents[idx] ?? 0n;
                  const liquido = centsParaNumero(liquidoCents > 0n ? liquidoCents : 0n);
                  const aberto = detalheAberto === i.productId;
                  const passou = passaDoEstoque(saldoDe(i.productId), i.quantity);
                  return (
                    <div key={i.productId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <Miniatura foto={fotoDe.get(i.productId) ?? null} className="size-11" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{i.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBRL(i.unitPrice)} / {nomeDaEmbalagem(i.saleUnit, 1)}
                          </p>
                        </div>
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums">{formatBRL(liquido)}</span>
                          {i.discountAmount > 0 && (
                            <span className="block text-[11px] text-muted-foreground line-through">
                              {formatBRL(bruto)}
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Rótulos explícitos: sem eles é fácil digitar o preço no campo
                          da quantidade e só perceber no total. No celular os campos
                          empilham — em 320px, lado a lado, o de preço ficava estreito
                          demais para "R$ 1.234,56". */}
                      <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2 sm:items-end">
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">
                            Quantidade{unidadeDe(i.saleUnit) ? ` (${unidadeDe(i.saleUnit)})` : ""}
                          </span>
                          {ehPeso(i.saleUnit) ? (
                            // Peso: ±1 kg não serve. Tomate sai a 2,350 kg, e o campo
                            // decimal é o único jeito de registrar isso sem arredondar.
                            <QuantityInput
                              value={i.quantity}
                              onChange={(v) => updateItem(i.productId, { quantity: v ?? 0 })}
                              aria-label={`Quantidade de ${i.name}`}
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-11 shrink-0"
                                aria-label="Diminuir quantidade"
                                onClick={() => tirarUm(i)}
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
                                className="h-11 min-w-0 flex-1 px-1 text-center tabular-nums"
                                value={i.quantity}
                                onChange={(e) =>
                                  updateItem(i.productId, { quantity: Number(e.target.value) || 0 })
                                }
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-11 shrink-0"
                                aria-label="Aumentar quantidade"
                                onClick={() =>
                                  updateItem(i.productId, { quantity: somarQuantidade(i.quantity, 1) })
                                }
                              >
                                <Plus className="size-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">Preço da unidade</span>
                          <CurrencyInput
                            value={i.unitPrice}
                            onChange={(v) => updateItem(i.productId, { unitPrice: v ?? 0 })}
                            aria-label={`Preço de ${i.name}`}
                          />
                        </div>
                      </div>

                      {/*
                        Quanto custou e quanto a praça publica — a margem visível na
                        hora de dizer o preço. Nunca altera `precoSugerido`, e o
                        preço do boletim nunca sai como um valor solto: vai sempre
                        com a palavra "boletim" e com a embalagem colada.
                      */}
                      <ReferenciaDeMercado
                        saleUnit={i.saleUnit}
                        pago={ultimosPagos[i.productId]}
                        boletim={boletim[i.productId]}
                      />

                      {i.unitPrice <= 0 && (
                        <p className="flex items-center gap-1 text-xs font-medium text-warning">
                          <AlertTriangle className="size-3.5 shrink-0" /> Sem preço — a venda sairia
                          zerada
                        </p>
                      )}

                      {/* Saldo antes → depois, na linha do item. */}
                      <p
                        className={cn(
                          "text-xs",
                          passou ? "font-medium text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {passou ? (
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

                      <div className="flex items-center justify-between gap-2">
                        {/* Vasilhame e desconto por linha ficam recolhidos: são o caso
                            incomum, e ocupariam a tela toda no celular. */}
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
                          onClick={() => setDetalheAberto(aberto ? null : i.productId)}
                          aria-expanded={aberto}
                        >
                          <ChevronDown
                            className={cn("size-3.5 transition-transform", aberto && "rotate-180")}
                          />
                          Vasilhame e desconto
                          {(i.recipientType || i.discountAmount > 0) && !aberto && (
                            <span className="text-primary">· preenchido</span>
                          )}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Remover ${i.name}`}
                          onClick={() => removeItem(i.productId)}
                        >
                          <Trash2 /> Remover
                        </Button>
                      </div>

                      {aberto && (
                        <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-2">
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
                              {/* Sem o módulo de caixas, "Caixa plástica" não é opção:
                                  o servidor descartaria as caixas e mesmo assim
                                  exigiria cliente para elas. */}
                              {toOptions(RECIPIENT_TYPE_LABELS)
                                .filter((o) => caixasHabilitado || o.value !== "PLASTICA")
                                .map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] text-muted-foreground">
                              Qtd. de vasilhames
                            </span>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              disabled={!i.recipientType}
                              aria-label={`Vasilhames de ${i.name}`}
                              value={i.crateQty || ""}
                              onChange={(e) =>
                                updateItem(i.productId, {
                                  crateQty: parseInt(e.target.value, 10) || 0,
                                })
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
                                  // Trava no bruto exato truncado — o mesmo teto do
                                  // `validar()`. Arredondado, 7,035 virava 7,04 e a
                                  // própria tela recusava o desconto que acabou de pôr.
                                  discountAmount: Math.min(
                                    v ?? 0,
                                    centsParaNumero(descontoMaximoDoItemCents(i)),
                                  ),
                                })
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {cart.length > 0 && (
              <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                <button
                  type="button"
                  className="flex items-center justify-between gap-1 text-sm font-medium"
                  onClick={() => setDescontoAberto((v) => !v)}
                  aria-expanded={descontoAberto}
                >
                  <span className="flex items-center gap-1">
                    <ChevronDown
                      className={cn("size-4 transition-transform", descontoAberto && "rotate-180")}
                    />
                    Desconto na venda
                  </span>
                  {descontoVenda > 0 && (
                    <span className="text-primary tabular-nums">{formatBRL(descontoVenda)}</span>
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
                          <CurrencyInput
                            value={descontoValor}
                            onChange={setDescontoValor}
                            aria-label="Valor do desconto"
                          />
                        ) : (
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step="any"
                            aria-label="Percentual de desconto"
                            value={descontoPercentual ?? ""}
                            // Entre 0 e 100: `min`/`max` do campo não impedem digitar
                            // "-5", e desconto negativo o servidor recusa.
                            onChange={(e) =>
                              setDescontoPercentual(
                                Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                              )
                            }
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">Motivo (opcional)</span>
                      <Input
                        placeholder="Ex.: cliente antigo, mercadoria madura"
                        maxLength={200}
                        value={descontoMotivo}
                        onChange={(e) => setDescontoMotivo(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </Etapa>

          <Etapa numero={4} titulo="Pagamento" dica="Como o cliente vai pagar">
            <div className="flex flex-col gap-3">
              {!dividido ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Forma de pagamento">
                    {PAYMENTS.map((p) => {
                      const Icone = p.icone;
                      const ativo = payment === p.value;
                      return (
                        <Button
                          key={p.value}
                          type="button"
                          variant={ativo ? "default" : "outline"}
                          aria-pressed={ativo}
                          onClick={() => setPayment(p.value)}
                          className="h-16 flex-col gap-1 px-2 text-sm"
                        >
                          <Icone className="size-5" aria-hidden="true" />
                          {p.label}
                        </Button>
                      );
                    })}
                  </div>
                  {cart.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={abrirDivisao}>
                      Dividir em mais de uma forma
                    </Button>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Pagamento dividido</span>
                    <Button type="button" variant="ghost" size="sm" onClick={fecharDivisao}>
                      Usar uma só forma
                    </Button>
                  </div>
                  {parcelas.map((p, idx) => (
                    <div key={idx} className="flex flex-col gap-2 rounded-md border p-2">
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
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          {/* O VALOR da forma é o campo que decide quanto do total
                              vira fiado; precisa de nome acessível próprio. */}
                          <CurrencyInput
                            aria-label={`Valor da forma de pagamento ${idx + 1}`}
                            value={p.amount}
                            onChange={(v) => setParcela(idx, { amount: v ?? 0 })}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-destructive hover:text-destructive"
                          aria-label="Remover forma de pagamento"
                          onClick={() => removeParcela(idx)}
                          disabled={parcelas.length === 1}
                        >
                          <Trash2 /> Remover
                        </Button>
                      </div>
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
                      ? "Informe o cliente no passo 1 — a parte fiada precisa de nome para virar conta a receber."
                      : "Informe o cliente no passo 1 — as caixas plásticas ficam registradas no nome dele."}
                  </span>
                </div>
              )}

              {/* Caixas plásticas só para quem tem o módulo: sem ele o bloco só gerava
                  dúvida, e o servidor chegava a barrar a venda por um saldo de caixas
                  que a empresa nem controla. */}
              {caixasHabilitado && (
                <div className="flex flex-col gap-2 rounded-md border p-2">
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
            </div>
          </Etapa>

          <Etapa
            numero={5}
            titulo="Retirada"
            dica="Obrigatório — o cliente leva agora ou vai buscar mais tarde?"
          >
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Retirada da mercadoria">
              {[
                { valor: false, titulo: "Leva agora", detalhe: "Sai do balcão já", Icone: PackageCheck },
                { valor: true, titulo: "Busca depois", detalhe: "Fica separado no box", Icone: Clock },
              ].map(({ valor, titulo, detalhe, Icone }) => {
                const ativo = retirarDepois === valor;
                return (
                  <button
                    key={titulo}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    onClick={() => setRetirarDepois(valor)}
                    className={cn(
                      "flex min-h-16 items-center gap-2.5 rounded-lg border-2 px-3 py-2 text-left outline-none motion-safe:transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      ativo
                        ? "border-primary bg-primary/10"
                        : retirarDepois === null && jaTentouFinalizar
                          ? "border-destructive/60 hover:bg-muted"
                          : "border-border hover:bg-muted",
                    )}
                  >
                    <Icone className={cn("size-5 shrink-0", ativo ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                    <span className="leading-tight">
                      <span className="block text-sm font-semibold">{titulo}</span>
                      <span className="block text-xs text-muted-foreground">{detalhe}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {retirarDepois && !customer.trim() && (
              <p className="mt-2 text-xs text-warning">
                Preencha o nome do cliente (etapa 1) para saber de quem é a mercadoria.
              </p>
            )}
          </Etapa>

          {/* Autocomplete nativo: sem JS extra, funciona em qualquer navegador e
              no teclado do celular. Evita o mesmo cliente virar "João", "joao" e
              "JOÃO" — três saldos separados no fiado e nas caixas. */}
          <datalist id={LISTA_CLIENTES}>
            {clientesConhecidos.map((nome) => (
              <option key={nome} value={nome} />
            ))}
          </datalist>

          {/* Total + finalizar: o ÚLTIMO passo, no fim da tela, em todo
              tamanho. Fixo no rodapé do celular ele cobria a tela o tempo todo;
              aqui a pessoa confere o pedido e só então confirma. */}
          <div
            data-testid="pdv-resumo"
            className="rounded-lg border-2 border-primary/40 bg-background p-3 shadow-sm"
          >
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

            {/* O detalhamento só cabe do `md` para cima; no celular a barra fixa
                fica com o essencial, para não cobrir a tela. */}
            <dl className="mb-2 hidden flex-col gap-1 border-b pb-2 text-sm md:flex">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">
                  {customer.trim() ? `Vendendo para ${customer.trim()}` : "Venda avulsa"}
                </dt>
                <dd className="text-muted-foreground">
                  {unidades} {unidades === 1 ? "produto" : "produtos"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatBRL(subtotal)}</dd>
              </div>
              {descontoTotal > 0 && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Desconto</dt>
                  <dd className="tabular-nums text-success">− {formatBRL(descontoTotal)}</dd>
                </div>
              )}
            </dl>

            <div className="mb-2 flex items-end justify-between gap-3">
              <span className="min-w-0 text-sm text-muted-foreground">
                <span className="md:hidden">
                  {customer.trim() ? (
                    <>
                      Vendendo para <b className="text-foreground">{customer.trim()}</b>
                    </>
                  ) : (
                    "Venda avulsa"
                  )}
                  {cart.length > 0 && (
                    <span className="block text-xs">
                      {unidades} {unidades === 1 ? "produto" : "produtos"}
                    </span>
                  )}
                </span>
                <span className="hidden font-medium text-foreground md:inline">Total da venda</span>
              </span>
              <span className="shrink-0 text-right">
                {descontoTotal > 0 && (
                  <span className="block text-xs text-muted-foreground line-through tabular-nums md:hidden">
                    {formatBRL(subtotal)}
                  </span>
                )}
                <span className="text-2xl font-bold tabular-nums text-primary" data-testid="pdv-total">
                  {formatBRL(total)}
                </span>
              </span>
            </div>

            {erroVisivel && (
              /*
                `role="alert"` para o leitor de tela anunciar sem a pessoa ter de
                procurar, e `aria-live="assertive"` porque isto interrompe uma ação
                que ela acabou de tentar — é o caso em que interromper é o certo.
              */
              <p
                role="alert"
                aria-live="assertive"
                className="mb-2 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{erroVisivel}</span>
              </p>
            )}

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
        </aside>
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

/** Um passo numerado da venda — o mesmo cartão para os quatro. */
function Etapa({
  numero,
  titulo,
  dica,
  children,
}: {
  numero: number;
  titulo: string;
  dica?: string;
  children: ReactNode;
}) {
  const id = `pdv-etapa-${numero}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      <header className="mb-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
        >
          {numero}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold leading-tight">
            {titulo}
          </h2>
          {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Filtro({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors",
        ativo ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function Miniatura({ foto, className }: { foto: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted",
        className,
      )}
    >
      {foto ? (
        // eslint-disable-next-line @next/next/no-img-element -- direto do bucket público
        <img src={foto} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Package className="size-1/2 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  );
}

/** Item novo no carrinho. Fora do componente: é puro, e assim o `adicionar` estável não depende dele. */
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

/**
 * Um produto na grade: a foto em destaque, o saldo por cima dela e o preço
 * sugerido embaixo.
 *
 * Fora do carrinho, o cartão inteiro é UM botão — o alvo de toque é o cartão
 * todo, com a mão suja de caixa. No carrinho, ganha −/+ para corrigir sem ir
 * até a lista do pedido (os nomes acessíveis são outros, para não se confundir
 * com os da linha do carrinho).
 */
const CartaoDeProduto = memo(function CartaoDeProduto({
  produto,
  saldo,
  preco,
  maisVendido,
  item,
  onAdicionar,
  onTirarUm,
  onPorUm,
}: {
  produto: Produto;
  saldo: number;
  preco: number;
  maisVendido: boolean;
  item?: CartItem;
  onAdicionar: (p: Produto) => void;
  onTirarUm: (i: CartItem) => void;
  onPorUm: (i: CartItem) => void;
}) {
  const nivel = nivelEstoque(saldo, produto.minStock);
  const unidade = nomeDaEmbalagem(produto.saleUnit, 1);
  const peso = produto.saleUnit === "KG";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-colors",
        item ? "border-primary ring-1 ring-primary" : "hover:border-primary/50",
        nivel === "zerado" && !item && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={() => onAdicionar(produto)}
        aria-label={`Adicionar ${produto.name}`}
        className="group flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative block aspect-[4/3] w-full overflow-hidden bg-muted">
          {produto.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- direto do bucket público
            <img
              src={produto.imageUrl}
              alt=""
              className="size-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <span className="flex size-full items-center justify-center">
              <Package className="size-10 text-muted-foreground/60" aria-hidden="true" />
            </span>
          )}
          {maisVendido && (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Mais vendido
            </span>
          )}
          {/* O saldo aqui evita descobrir que faltou mercadoria só no erro do
              servidor, com o cliente esperando. */}
          <span
            className={cn(
              "absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              nivel === "zerado"
                ? "bg-destructive text-destructive-foreground"
                : nivel === "acabando"
                  ? "bg-warning text-warning-foreground"
                  : "bg-foreground/75 text-background",
            )}
          >
            {nivel === "zerado"
              ? "sem estoque"
              : `${formatQty(saldo)} em estoque${nivel === "acabando" ? " · acabando" : ""}`}
          </span>
        </span>
        <span className="flex flex-1 flex-col gap-0.5 p-2 sm:p-3">
          <span className="line-clamp-2 text-sm font-semibold leading-tight">{produto.name}</span>
          <span className="text-[11px] text-muted-foreground">{SALE_UNIT_LABELS[produto.saleUnit]}</span>
          <span className="mt-auto pt-1 text-sm font-bold tabular-nums">
            {preco > 0 ? formatBRL(preco) : "sem preço"}
            <span className="text-[11px] font-normal text-muted-foreground"> /{unidade}</span>
          </span>
        </span>
      </button>

      <div className="flex items-center justify-between gap-1 border-t px-2 py-1.5">
        {item ? (
          peso ? (
            <span className="text-xs font-medium text-primary">
              No carrinho: {formatQty(item.quantity)} kg
            </span>
          ) : (
            <div className="flex w-full items-center justify-between gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9"
                aria-label={`Tirar 1 de ${produto.name}`}
                onClick={() => onTirarUm(item)}
              >
                <Minus className="size-4" />
              </Button>
              <span className="text-sm font-semibold tabular-nums" aria-label={`No carrinho: ${formatQty(item.quantity)}`}>
                {formatQty(item.quantity)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9"
                aria-label={`Mais 1 de ${produto.name}`}
                onClick={() => onPorUm(item)}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          )
        ) : (
          <span className="flex w-full items-center justify-between text-xs text-muted-foreground">
            Toque para adicionar
            <Plus className="size-4 text-primary" aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
});

/**
 * O custo e o boletim, embaixo da linha do carrinho.
 *
 * Responde "posso cobrar isso?" com os dois números que o dono do box teria de
 * lembrar de cabeça: o que ele pagou e o que a praça está publicando. Não sugere
 * preço, não calcula margem, não escreve porcentagem — a decisão do balcão é
 * dele, e uma porcentagem aqui viraria alvo.
 *
 * O boletim só aparece quando a embalagem dele fala da mesma unidade que o
 * produto é vendido. Um "R$ 4,20 por KG" ao lado do preço de um produto vendido
 * por CAIXA está certo e é ilegível no balcão: o operador vê o número, digita
 * por cima e vende a caixa a R$ 4,20.
 */
function ReferenciaDeMercado({
  saleUnit,
  pago,
  boletim,
}: {
  saleUnit: string;
  pago?: { unitPrice: number; purchaseDate: string | Date };
  boletim?: ReferenciaDoBoletim;
}) {
  const comparavel =
    boletim && ehSaleUnit(saleUnit) && embalagemCasaComVenda(boletim.unit, saleUnit);
  if (!pago && !comparavel) return null;

  return (
    <p
      data-testid="referencia-de-mercado"
      className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground"
    >
      {pago && (
        <span>
          comprou a <span className="tabular-nums">{formatBRL(pago.unitPrice)}</span> (sem frete)
        </span>
      )}
      {comparavel && (
        <span>
          boletim <span className="tabular-nums">{formatBRL(boletim.refPrice)}</span> por{" "}
          {boletim.unit}
        </span>
      )}
    </p>
  );
}

/** `CartItem.saleUnit` é `string`; só o enum serve para casar embalagem. */
function ehSaleUnit(v: string): v is SaleUnit {
  return SALE_UNITS.includes(v as SaleUnit);
}

const SALE_UNITS: SaleUnit[] = ["CAIXA", "KG", "SACO", "BANDEJA", "UNIDADE"];
