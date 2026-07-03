"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { planoSchema, type PlanoInput } from "@/lib/validations/admin";
import { criarPlano } from "@/actions/admin.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/forms/currency-input";

export function PlanoForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<PlanoInput>({
    resolver: zodResolver(planoSchema),
    defaultValues: { name: "", priceMonthly: 0, active: true },
  });

  async function onSubmit(values: PlanoInput) {
    setSaving(true);
    const res = await criarPlano(values);
    setSaving(false);
    if (res.ok) {
      toast.success("Plano criado");
      reset({ name: "", priceMonthly: 0, active: true });
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nome do plano</Label>
        <Input id="name" placeholder="Ex.: Básico" {...register("name")} />
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
          <Label htmlFor="maxUsers">Máx. usuários (opcional)</Label>
          <Input
            id="maxUsers"
            type="number"
            {...register("maxUsers", {
              setValueAs: (v) => (v === "" ? null : Number(v)),
            })}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" defaultChecked {...register("active")} />
        Plano ativo
      </label>
      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Criar plano
      </Button>
    </form>
  );
}
