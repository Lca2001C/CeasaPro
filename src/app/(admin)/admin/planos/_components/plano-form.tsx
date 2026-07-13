"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { planoSchema, type PlanoInput } from "@/lib/validations/admin";
import { criarPlano, atualizarPlano } from "@/actions/admin.actions";
import { OPTIONAL_MODULE_KEYS, OPTIONAL_MODULES, ALL_OPTIONAL_KEYS } from "@/lib/plan/modules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/forms/currency-input";

interface Props {
  initial?: PlanoInput & { id: string };
  onDone?: () => void;
}

export function PlanoForm({ initial, onDone }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<PlanoInput>({
    resolver: zodResolver(planoSchema),
    defaultValues:
      initial ?? {
        name: "",
        priceMonthly: 0,
        active: true,
        maxUsers: null,
        modules: [...ALL_OPTIONAL_KEYS],
      },
  });

  async function onSubmit(values: PlanoInput) {
    setSaving(true);
    const res = initial
      ? await atualizarPlano({ ...values, id: initial.id })
      : await criarPlano(values);
    setSaving(false);
    if (res.ok) {
      toast.success(initial ? "Plano atualizado" : "Plano criado");
      if (!initial) reset({ name: "", priceMonthly: 0, active: true, maxUsers: null, modules: [...ALL_OPTIONAL_KEYS] });
      router.refresh();
      onDone?.();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`name-${initial?.id ?? "new"}`}>Nome do plano</Label>
        <Input id={`name-${initial?.id ?? "new"}`} placeholder="Ex.: Básico" {...register("name")} />
        {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Preço mensal</Label>
          <Controller
            control={control}
            name="priceMonthly"
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
            )}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Máx. usuários (opcional)</Label>
          <Input
            type="number"
            {...register("maxUsers", { setValueAs: (v) => (v === "" ? null : Number(v)) })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Módulos incluídos</Label>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {OPTIONAL_MODULE_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" value={key} {...register("modules")} />
              {OPTIONAL_MODULES[key].label}
            </label>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          Módulos básicos (produtos, vendas, fiado, estoque, despesas, relatórios básicos) sempre inclusos.
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...register("active")} />
        Plano ativo
      </label>
      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        {initial ? "Salvar alterações" : "Criar plano"}
      </Button>
    </form>
  );
}
