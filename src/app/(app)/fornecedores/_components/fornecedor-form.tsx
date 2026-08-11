"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { fornecedorSchema, type FornecedorInput } from "@/lib/validations/fornecedor";
import { criarFornecedor, atualizarFornecedor } from "@/actions/fornecedores.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhoneInput } from "@/components/forms/phone-input";

interface Props {
  initial?: FornecedorInput & { id: string };
}

export function FornecedorForm({ initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FornecedorInput>({
    resolver: zodResolver(fornecedorSchema),
    defaultValues: initial ?? { name: "", active: true },
  });

  async function onSubmit(values: FornecedorInput) {
    setSaving(true);
    const res = initial
      ? await atualizarFornecedor({ ...values, id: initial.id })
      : await criarFornecedor(values);
    setSaving(false);
    if (res.ok) {
      toast.success(initial ? "Fornecedor atualizado" : "Fornecedor cadastrado");
      router.push("/fornecedores");
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" autoFocus {...register("name")} />
        {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Telefone</Label>
        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <PhoneInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} id="phone" />
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Endereço</Label>
        <Input id="address" {...register("address")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Observações</Label>
        <Textarea id="notes" {...register("notes")} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...register("active")} />
        Fornecedor ativo
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
