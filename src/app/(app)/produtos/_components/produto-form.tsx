"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { produtoSchema, type ProdutoInput } from "@/lib/validations/produto";
import { criarProduto, atualizarProduto } from "@/actions/produtos.actions";
import { SALE_UNIT_LABELS, RECIPIENT_TYPE_LABELS, toOptions } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { QuantityInput } from "@/components/forms/quantity-input";

interface Props {
  initial?: ProdutoInput & { id: string };
}

export function ProdutoForm({ initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ProdutoInput>({
    resolver: zodResolver(produtoSchema),
    defaultValues: initial ?? { name: "", saleUnit: "CAIXA", active: true },
  });

  async function onSubmit(values: ProdutoInput) {
    setSaving(true);
    const res = initial
      ? await atualizarProduto({ ...values, id: initial.id })
      : await criarProduto(values);
    setSaving(false);
    if (res.ok) {
      toast.success(initial ? "Produto atualizado" : "Produto cadastrado");
      router.push("/produtos");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nome do produto</Label>
        <Input id="name" autoFocus placeholder="Ex.: Tomate" {...register("name")} />
        {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="saleUnit">Unidade de venda</Label>
        <Select id="saleUnit" {...register("saleUnit")}>
          {toOptions(SALE_UNIT_LABELS).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipientType">Tipo de caixa (opcional)</Label>
        <Select
          id="recipientType"
          defaultValue=""
          {...register("recipientType", {
            setValueAs: (v) => (v === "" ? null : v),
          })}
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
          <Label>Qtd. por recipiente</Label>
          <Controller
            control={control}
            name="qtyPerRecipient"
            render={({ field }) => (
              <QuantityInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
            )}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Capacidade do saco</Label>
          <Controller
            control={control}
            name="sackCapacity"
            render={({ field }) => (
              <QuantityInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
            )}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...register("active")} />
        Produto ativo
      </label>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Salvar
        </Button>
      </div>
    </form>
  );
}
