"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { despesaSchema, type DespesaInput } from "@/lib/validations/despesa";
import { criarDespesa, atualizarDespesa } from "@/actions/despesas.actions";
import { EXPENSE_TYPE_LABELS, EXPENSE_STATUS_LABELS, toOptions } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CurrencyInput } from "@/components/forms/currency-input";

interface Props {
  categories: { id: string; name: string }[];
  initial?: DespesaInput & { id: string };
}

export function DespesaForm({ categories, initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<DespesaInput>({
    resolver: zodResolver(despesaSchema),
    defaultValues: initial ?? { description: "", type: "VARIAVEL", status: "PENDENTE" },
  });

  async function onSubmit(values: DespesaInput) {
    setSaving(true);
    const res = initial
      ? await atualizarDespesa({ ...values, id: initial.id })
      : await criarDespesa(values);
    setSaving(false);
    if (res.ok) {
      toast.success(initial ? "Despesa atualizada" : "Despesa cadastrada");
      router.push("/despesas");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  const nullIfEmpty = { setValueAs: (v: string) => (v === "" ? null : v) };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Descrição</Label>
        <Input id="description" autoFocus {...register("description")} />
        {errors.description && (
          <span className="text-xs text-destructive">{errors.description.message}</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Valor</Label>
        <Controller
          control={control}
          name="amount"
          render={({ field }) => (
            <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
          )}
        />
        {errors.amount && <span className="text-xs text-destructive">{errors.amount.message}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="type">Tipo</Label>
          <Select id="type" {...register("type")}>
            {toOptions(EXPENSE_TYPE_LABELS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Situação</Label>
          <Select id="status" {...register("status")}>
            {toOptions(EXPENSE_STATUS_LABELS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="categoryId">Categoria</Label>
        <Select id="categoryId" defaultValue="" {...register("categoryId", nullIfEmpty)}>
          <option value="">— Sem categoria —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dueDate">Vencimento</Label>
          <Input id="dueDate" type="date" {...register("dueDate", nullIfEmpty)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paidDate">Pagamento</Label>
          <Input id="paidDate" type="date" {...register("paidDate", nullIfEmpty)} />
        </div>
      </div>

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
