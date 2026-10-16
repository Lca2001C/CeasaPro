"use client";

import { isoDateTz } from "@/lib/tz";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { formatBRL, formatDateOnly } from "@/lib/format";
import { EXPENSE_PAYMENT_METHOD_LABELS, toOptions } from "@/lib/labels";
import { ProdutoModal } from "@/components/produtos/produto-modal";
import type { ReferenciaDoBoletim } from "@/lib/services/cotacoes.service";
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
  produtos: produtosDoServidor,
  fornecedores,
  ultimosPagos = {},
  boletim = {},
  caixasHabilitado = false,
  fotosDisponiveis = false,
}: {
  produtos: Option[];
  /** O armazenamento de fotos está configurado (modal "+ Novo produto"). */
  fotosDisponiveis?: boolean;
  fornecedores: Option[];
  /**
   * O plano inclui o módulo `caixas`? Sem ele o bloco "chegou em caixa
   * plástica" nem aparece — o servidor ignoraria as caixas de qualquer jeito.
   * Nasce `false` (fail-closed, como `isModuleEnabled`).
   */
  caixasHabilitado?: boolean;
  /** Último preço NEGOCIADO por produto (sem frete) — ver `ultimosPrecosPagos`. */
  ultimosPagos?: Record<string, { unitPrice: number; purchaseDate: string | Date }>;
  /** Boletim do produto vinculado. Vazio quando o plano não inclui Cotações. */
  boletim?: Record<string, ReferenciaDoBoletim>;
}) {
  const router = useRouter();
  // Produto cadastrado aqui mesmo ("+ Novo produto") entra na lista na hora,
  // sem esperar o `router.refresh` trazer a lista nova do servidor.
  const [novosProdutos, setNovosProdutos] = useState<Option[]>([]);
  const produtos = [
    ...produtosDoServidor,
    ...novosProdutos.filter((n) => !produtosDoServidor.some((p) => p.id === n.id)),
  ];
  const [modalProduto, setModalProduto] = useState<{ item: number } | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(isoDateTz());
  const [freight, setFreight] = useState(0);
  const [items, setItems] = useState<Item[]>([
    { productId: produtos[0]?.id ?? "", quantity: 1, unitPrice: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  // Trava SÍNCRONA contra toque duplo em "Salvar compra". `saving` sozinho não
  // basta: ele só desabilita o botão no próximo render, e dois toques no mesmo
  // instante disparavam dois POST. Cada POST é uma compra nova — duas ENTRADAs
  // de estoque, duas entradas de caixas e duas despesas de frete (a trava por
  // `purchaseId` da despesa não pega, porque são compras diferentes).
  const enviando = useRef(false);
  // Uma chave por compra digitada: se o envio sair duas vezes (toque duplo,
  // retentativa depois de timeout), o servidor devolve a compra já gravada.
  const chaveDaCompra = useRef<string | null>(null);
  const [veioEmCaixa, setVeioEmCaixa] = useState(false);
  const [caixasRecebidas, setCaixasRecebidas] = useState("");
  const [caixasQuebradas, setCaixasQuebradas] = useState("");
  const [caixasSujas, setCaixasSujas] = useState(false);
  // Toda compra vira uma conta em Despesas, no valor total e com o fornecedor:
  // paga agora (sai do caixa hoje) ou a prazo (vai para Contas a Pagar).
  const [pagoAgora, setPagoAgora] = useState(true);
  const [formaPagamento, setFormaPagamento] = useState("");
  const [vencimento, setVencimento] = useState("");

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
    if (enviando.current) return;
    if (produtos.length === 0) return toast.error("Cadastre um produto primeiro.");
    if (items.some((i) => !i.productId || i.quantity <= 0))
      return toast.error("Preencha os itens corretamente.");

    const caixas = veioEmCaixa ? parseInt(caixasRecebidas, 10) || 0 : 0;
    const quebradas = veioEmCaixa ? parseInt(caixasQuebradas, 10) || 0 : 0;
    if (veioEmCaixa && caixas <= 0)
      return toast.error("Informe quantas caixas plásticas chegaram.");
    if (quebradas > caixas)
      return toast.error("As caixas quebradas não podem passar do total recebido.");
    if (!pagoAgora && !vencimento) return toast.error("Informe até quando vai pagar a compra.");
    if (!pagoAgora && vencimento < purchaseDate)
      return toast.error("O vencimento não pode ser antes da data da compra.");

    enviando.current = true;
    setSaving(true);
    chaveDaCompra.current ??= crypto.randomUUID();
    const res = await apiPost<{ id: string }>("/api/compras", {
      idempotencyKey: chaveDaCompra.current,
      supplierId: supplierId || null,
      purchaseDate,
      freight: freight || 0,
      caixasRecebidas: caixas,
      caixasQuebradas: quebradas,
      caixasSujas: veioEmCaixa && caixasSujas,
      pagamento: pagoAgora
        ? { status: "PAGO", paymentMethod: formaPagamento || null }
        : { status: "PENDENTE", paymentMethod: formaPagamento || null, dueDate: vencimento },
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice || 0,
      })),
    });
    if (res.ok) {
      // No sucesso o botão CONTINUA travado. A ida para o Estoque é uma
      // transição do App Router: esta tela segue na frente, clicável, até a
      // página nova (force-dynamic) chegar — no 4G do CEASA, segundos. Era
      // `setSaving(false)` antes do `push`, e o segundo toque gravava outra compra.
      const conta = pagoAgora ? "Conta lançada como paga." : "Conta lançada em Contas a Pagar.";
      toast.success(
        caixas > 0
          ? `Compra registrada. Estoque atualizado e ${caixas} caixa(s) na entrada. ${conta}`
          : `Compra registrada. Estoque atualizado. ${conta}`,
      );
      router.push("/estoque?aba=compras");
    } else {
      enviando.current = false;
      setSaving(false);
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="purchaseDate">Data</Label>
          <Input
            id="purchaseDate"
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="supplierId">Fornecedor</Label>
          <Select
            id="supplierId"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
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
        {/*
          Daqui para baixo os campos se REPETEM por item, então `id` não serve:
          dois itens dariam o mesmo id e o rótulo apontaria para o primeiro.
          Cada controle leva um `aria-label` com o número do item — que é a
          única forma de quem usa leitor de tela saber se está no preço do
          item 1 ou do item 4 numa compra com uma dúzia de produtos.
        */}
        <div className="flex items-center justify-between gap-2">
          <Label>Itens</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setModalProduto({ item: items.length - 1 })}
          >
            <Plus /> Novo produto
          </Button>
        </div>
        {produtos.length === 0 && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Nenhum produto cadastrado. Toque em <b>Novo produto</b> para cadastrar o que chegou.
          </p>
        )}
        {items.map((it, idx) => (
          <Card key={idx} className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-2">
              <Select
                aria-label={`Produto do item ${idx + 1}`}
                className="flex-1"
                value={it.productId}
                onChange={(e) => setItem(idx, { productId: e.target.value })}
              >
                {!it.productId && <option value="">— Escolha o produto —</option>}
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
                // Só o ícone da lixeira: sem nome acessível o axe acusava
                // `button-name` (crítico), e o leitor de tela anunciava apenas
                // "botão" — num controle que APAGA uma linha da compra.
                aria-label={`Remover item ${idx + 1}`}
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
                  aria-label={`Quantidade do item ${idx + 1}`}
                  value={it.quantity}
                  onChange={(v) => setItem(idx, { quantity: v ?? 0 })}
                />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Preço unitário</span>
                <CurrencyInput
                  aria-label={`Preço unitário do item ${idx + 1}`}
                  value={it.unitPrice}
                  onChange={(v) => setItem(idx, { unitPrice: v ?? 0 })}
                />
              </div>
            </div>
            <Referencia ultimo={ultimosPagos[it.productId]} boletim={boletim[it.productId]} />
          </Card>
        ))}
        <Button type="button" variant="outline" onClick={addItem}>
          <Plus /> Adicionar item
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="freight">Frete</Label>
        <CurrencyInput id="freight" value={freight} onChange={(v) => setFreight(v ?? 0)} />
        <span className="text-xs text-muted-foreground">
          O frete entra no custo de cada produto automaticamente, rateado pelo valor, e na conta da
          compra em Despesas.
        </span>
      </div>

      {/* Caixas plásticas que vieram junto: registrar aqui evita o segundo
          lançamento em outra tela — que era esquecido e fazia o saldo de
          caixas divergir do que existe no box. Só com o módulo de caixas. */}
      {caixasHabilitado && (
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
      )}

      {/* A conta da compra. Fica em Despesas ligada ao fornecedor; não entra
          no lucro de novo, porque o custo já está no preço de cada produto. */}
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <span className="text-sm font-medium">Pagamento</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pagamento da compra">
          <Button
            type="button"
            role="radio"
            aria-checked={pagoAgora}
            variant={pagoAgora ? "default" : "outline"}
            onClick={() => setPagoAgora(true)}
          >
            Pago agora
          </Button>
          <Button
            type="button"
            role="radio"
            aria-checked={!pagoAgora}
            variant={!pagoAgora ? "default" : "outline"}
            onClick={() => {
              setPagoAgora(false);
              if (!vencimento) setVencimento(purchaseDate);
            }}
          >
            A pagar
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="forma-pagamento">Forma</Label>
            <Select
              id="forma-pagamento"
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
            >
              <option value="">— Não informado —</option>
              {toOptions(EXPENSE_PAYMENT_METHOD_LABELS).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          {!pagoAgora && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vencimento">Pagar até</Label>
              <Input
                id="vencimento"
                type="date"
                min={purchaseDate}
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
              />
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {pagoAgora
            ? "A conta entra em Despesas como paga hoje."
            : "A conta vai para Contas a Pagar, com o fornecedor, até o vencimento."}
        </span>
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

      <ProdutoModal
        open={modalProduto !== null}
        onOpenChange={(v) => {
          if (!v) setModalProduto(null);
        }}
        fotosDisponiveis={fotosDisponiveis}
        onSalvo={(p) => {
          setNovosProdutos((s) => [...s, { id: p.id, name: p.name }]);
          // O produto novo vai para o item de onde o cadastro foi aberto.
          const alvo = modalProduto?.item ?? items.length - 1;
          setItem(Math.max(0, alvo), { productId: p.id });
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * Duas referências debaixo do preço, e nada além disso.
 *
 * O que o comerciante fazia de cabeça, ou não fazia: lembrar quanto pagou da
 * última vez e quanto a praça está publicando. As duas coisas ficam ao lado do
 * campo, no momento da decisão.
 *
 * Três decisões de produto aqui, todas do tipo "o que NÃO fazer":
 *
 *  - **Não preenche o campo.** Não há botão "usar". O boletim é preço de
 *    mercado na praça; o que a pessoa paga é negociado no balcão. Preencher o
 *    custo com o boletim gravaria um custo que ninguém pagou, e esse número
 *    entra no CMV, no lucro e na margem de todos os relatórios.
 *  - **Não calcula diferença.** "Você pagou 8% acima" só faz sentido se as duas
 *    pontas estiverem na mesma unidade, e não estão: o cliente compra por caixa
 *    ou por quilo, e o boletim publica na embalagem dele. A embalagem vai
 *    SEMPRE colada ao preço, e a conta fica com quem sabe qual é qual.
 *  - **"sem frete" é escrito.** O último pago é o `unitPrice`, sem o rateio do
 *    caminhão. Sem essa palavra, quem compara com o boletim conclui que pagou
 *    caro quando a diferença é o transporte.
 */
function Referencia({
  ultimo,
  boletim,
}: {
  ultimo?: { unitPrice: number; purchaseDate: string | Date };
  boletim?: ReferenciaDoBoletim;
}) {
  if (!ultimo && !boletim) return null;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
      {ultimo && (
        <span>
          último pago{" "}
          <span className="font-medium tabular-nums">{formatBRL(ultimo.unitPrice)}</span> (sem
          frete)
        </span>
      )}
      {boletim && (
        <span>
          boletim de {formatDateOnly(boletim.quoteDate)}{" "}
          <span className="font-medium tabular-nums">{formatBRL(boletim.refPrice)}</span>
          {boletim.unit ? ` por ${boletim.unit}` : ""}
          {boletim.precoPorKg !== null && boletim.unit.trim().toUpperCase() !== "KG"
            ? ` (≈ ${formatBRL(boletim.precoPorKg)}/kg)`
            : ""}
        </span>
      )}
    </p>
  );
}
