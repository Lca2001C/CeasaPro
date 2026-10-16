"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { produtoSchema, type ProdutoInput } from "@/lib/validations/produto";
import { criarProduto, atualizarProduto } from "@/actions/produtos.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { RECIPIENT_TYPE_LABELS, SALE_UNIT_LABELS, toOptions } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CurrencyInput } from "@/components/forms/currency-input";
import { QuantityInput } from "@/components/forms/quantity-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImagemProduto, type FotoEscolhida } from "./imagem-produto";
import { CustosDaCarga } from "./custos-da-carga";
import { SeusProdutos, type ProdutoSugerido } from "./seus-produtos";
import { calcularCustoDaCarga } from "@/lib/estoque/custo-carga";

/** Produto como o modal precisa para EDITAR (números simples: Decimal não atravessa). */
export interface ProdutoEditavel {
  id: string;
  name: string;
  saleUnit: ProdutoInput["saleUnit"];
  salePrice: number | null;
  minStock: number | null;
  imageKey: string | null;
  imageUrl: string | null;
  recipientType: ProdutoInput["recipientType"];
  qtyPerRecipient: number | null;
  sackCapacity: number | null;
  active: boolean;
  /** Já tem compra, venda ou movimento: a embalagem fica travada (o servidor recusa trocar). */
  temHistorico: boolean;
}

/**
 * "Novo Produto" — o cadastro inteiro numa tela só.
 *
 * Antes eram três telas para pôr um produto à venda: o cadastro, a compra (para
 * ter estoque e custo) e o estoque (para conferir). Aqui o dono informa o nome,
 * a embalagem, o preço de venda, quanto já tem no box (com o custo — é ele que
 * vira o custo médio e o lucro das primeiras vendas), o alerta e a foto.
 *
 * Os campos menos usados (caixa, quantidade por caixa, saco, ativo) ficam em
 * "Mais opções", recolhido.
 */
export function ProdutoModal({
  open,
  onOpenChange,
  produto,
  fotosDisponiveis,
  meusProdutos = [],
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produto?: ProdutoEditavel | null;
  fotosDisponiveis: boolean;
  /** Produtos já cadastrados, para a lista "Seus produtos" do cadastro. */
  meusProdutos?: ProdutoSugerido[];
  onSalvo?: (p: { id: string; name: string; saleUnit: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[90dvh] gap-0 overflow-y-auto p-0",
          // No celular, tela cheia: teclado aberto + 6 campos não cabem num cartão.
          "max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none",
        )}
      >
        <DialogHeader className="border-b px-4 py-4">
          <DialogTitle>{produto ? "Editar produto" : "Novo Produto"}</DialogTitle>
          <DialogDescription className="sr-only">
            Nome, embalagem, preço de venda, estoque e foto do produto.
          </DialogDescription>
        </DialogHeader>
        {/* Montado só aberto e com `key`: abrir de novo (ou outro produto)
            recomeça o formulário do zero, sem efeito para "resetar". */}
        {open && (
          <FormularioProduto
            key={produto?.id ?? "novo"}
            produto={produto ?? null}
            fotosDisponiveis={fotosDisponiveis}
            meusProdutos={meusProdutos}
            onSalvo={(p) => {
              onSalvo?.(p);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormularioProduto({
  produto,
  fotosDisponiveis,
  meusProdutos,
  onSalvo,
}: {
  produto: ProdutoEditavel | null;
  fotosDisponiveis: boolean;
  meusProdutos: ProdutoSugerido[];
  onSalvo: (p: { id: string; name: string; saleUnit: string }) => void;
}) {
  const editando = Boolean(produto);
  const unidadeTravada = Boolean(produto?.temHistorico);
  const [saving, setSaving] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [foto, setFoto] = useState<FotoEscolhida | null>(
    produto?.imageKey ? { imageKey: produto.imageKey, url: produto.imageUrl } : null,
  );
  const [maisOpcoes, setMaisOpcoes] = useState(false);
  const [custoMercadoria, setCustoMercadoria] = useState<number | null>(null);
  const [custoDescarga, setCustoDescarga] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<ProdutoInput>({
    resolver: zodResolver(produtoSchema),
    defaultValues: produto
      ? {
          name: produto.name,
          saleUnit: produto.saleUnit,
          active: produto.active,
          salePrice: produto.salePrice,
          minStock: produto.minStock,
          imageKey: produto.imageKey,
          recipientType: produto.recipientType ?? null,
          qtyPerRecipient: produto.qtyPerRecipient,
          sackCapacity: produto.sackCapacity,
          estoqueInicial: null,
          custoInicial: null,
        }
      : {
          name: "",
          saleUnit: "CAIXA",
          active: true,
          salePrice: null,
          minStock: null,
          imageKey: null,
          estoqueInicial: null,
          custoInicial: null,
          recipientType: null,
          qtyPerRecipient: null,
          sackCapacity: null,
        },
  });

  const nome = useWatch({ control, name: "name" }) ?? "";
  const saleUnit = useWatch({ control, name: "saleUnit" });
  const estoqueInicial = useWatch({ control, name: "estoqueInicial" });

  function mudarCustos(mercadoria: number | null, descarga: number | null) {
    setCustoMercadoria(mercadoria);
    setCustoDescarga(descarga);
    setValue("custoInicial", calcularCustoDaCarga(1, mercadoria, descarga).custoUnitario, {
      shouldValidate: Boolean(errors.custoInicial),
    });
  }

  function preencherCom(p: ProdutoSugerido) {
    setValue("name", p.name, { shouldValidate: true });
    if (p.saleUnit && !unidadeTravada) {
      setValue("saleUnit", p.saleUnit as ProdutoInput["saleUnit"]);
    }
    if (p.salePrice !== undefined) setValue("salePrice", p.salePrice);
  }

  async function onSubmit(values: ProdutoInput) {
    setSaving(true);
    const imageKey = foto?.imageKey ?? null;
    const res = produto
      ? await chamarAction(() =>
          atualizarProduto({
            id: produto.id,
            name: values.name,
            saleUnit: values.saleUnit,
            active: values.active,
            salePrice: values.salePrice ?? null,
            minStock: values.minStock ?? null,
            imageKey,
            recipientType: values.recipientType ?? null,
            qtyPerRecipient: values.qtyPerRecipient ?? null,
            sackCapacity: values.sackCapacity ?? null,
          }),
        )
      : await chamarAction(() => criarProduto({ ...values, imageKey }));
    setSaving(false);
    if (res.ok) {
      toast.success(produto ? "Produto atualizado" : "Produto cadastrado");
      onSalvo({ id: res.data.id, name: res.data.name, saleUnit: res.data.saleUnit });
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col">
      <div className="flex flex-col gap-4 px-4 py-4">
        {!editando && (
          <SeusProdutos produtos={meusProdutos} nomeDigitado={nome} onEscolher={preencherCom} />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="produto-nome">Nome do Produto *</Label>
          <Input
            id="produto-nome"
            autoFocus
            placeholder="Ex: Tomate Italiano"
            {...register("name")}
          />
          {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="produto-embalagem">Embalagem</Label>
          {unidadeTravada ? (
            <>
              {/* Campo nativo desabilitado sai do submit do RHF: o valor vai escondido. */}
              <Select
                id="produto-embalagem"
                disabled
                defaultValue={produto?.saleUnit}
                aria-describedby="embalagem-travada"
              >
                {toOptions(SALE_UNIT_LABELS).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <input type="hidden" {...register("saleUnit")} />
              <span id="embalagem-travada" className="text-xs text-muted-foreground">
                Este produto já tem compras, vendas ou estoque lançados, e a embalagem não pode
                mudar. Para vender em outra embalagem, cadastre um produto novo.
              </span>
            </>
          ) : (
            <Select id="produto-embalagem" {...register("saleUnit")}>
              {toOptions(SALE_UNIT_LABELS).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="produto-preco">
              Preço de Venda <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Controller
              control={control}
              name="salePrice"
              render={({ field }) => (
                <CurrencyInput
                  id="produto-preco"
                  placeholder="R$ 0,00"
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? null)}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>
          {editando ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="produto-alerta">Alerta de Estoque</Label>
              <Controller
                control={control}
                name="minStock"
                render={({ field }) => (
                  <QuantityInput
                    id="produto-alerta"
                    placeholder="Qtd. mínima"
                    value={field.value}
                    onChange={(v) => field.onChange(v ?? null)}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="produto-estoque">Estoque Inicial</Label>
              <Controller
                control={control}
                name="estoqueInicial"
                render={({ field }) => (
                  <QuantityInput
                    id="produto-estoque"
                    placeholder="0"
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v ?? null);
                      if (!v) mudarCustos(null, null);
                    }}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </div>
          )}
        </div>

        {!editando && estoqueInicial != null && estoqueInicial > 0 && (
          <CustosDaCarga
            quantidade={estoqueInicial}
            saleUnit={saleUnit}
            mercadoria={custoMercadoria}
            descarga={custoDescarga}
            onMercadoria={(v) => mudarCustos(v, custoDescarga)}
            onDescarga={(v) => mudarCustos(custoMercadoria, v)}
            erro={errors.custoInicial?.message}
          />
        )}

        {!editando && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="produto-alerta">Alerta de Estoque</Label>
            <Controller
              control={control}
              name="minStock"
              render={({ field }) => (
                <QuantityInput
                  id="produto-alerta"
                  placeholder="Quantidade mínima para alerta"
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? null)}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Imagem do Produto</span>
          <ImagemProduto
            valor={foto}
            onChange={setFoto}
            onEnviando={setEnviandoFoto}
            nomeDoProduto={nome}
            disponivel={fotosDisponiveis}
          />
        </div>

        <div className="rounded-lg border">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
            onClick={() => setMaisOpcoes((v) => !v)}
            aria-expanded={maisOpcoes}
          >
            Mais opções
            <ChevronDown
              className={cn("size-4 transition-transform", maisOpcoes && "rotate-180")}
            />
          </button>
          {maisOpcoes && (
            <div className="flex flex-col gap-3 border-t px-3 py-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="produto-caixa">Tipo de caixa</Label>
                <Select
                  id="produto-caixa"
                  {...register("recipientType", { setValueAs: (v) => (v === "" ? null : v) })}
                >
                  <option value="">— Nenhum —</option>
                  {toOptions(RECIPIENT_TYPE_LABELS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="produto-qtd-caixa">Qtd. por recipiente</Label>
                  <Controller
                    control={control}
                    name="qtyPerRecipient"
                    render={({ field }) => (
                      <QuantityInput
                        id="produto-qtd-caixa"
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? null)}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="produto-saco">Capacidade do saco</Label>
                  <Controller
                    control={control}
                    name="sackCapacity"
                    render={({ field }) => (
                      <QuantityInput
                        id="produto-saco"
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? null)}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" {...register("active")} />
                Produto ativo
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 border-t bg-background px-4 py-3">
        <Button type="submit" size="lg" className="w-full" disabled={saving || enviandoFoto}>
          {(saving || enviandoFoto) && <Loader2 className="animate-spin" />}
          {enviandoFoto ? "Enviando foto..." : editando ? "Salvar alterações" : "Salvar Produto"}
        </Button>
      </div>
    </form>
  );
}
