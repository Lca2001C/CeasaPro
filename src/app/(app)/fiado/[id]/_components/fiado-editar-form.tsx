"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { atualizarFiado } from "@/actions/fiado.actions";
import { fiadoUpdateSchema, type FiadoUpdateInput } from "@/lib/validations/fiado";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/forms/phone-input";

export function FiadoEditarForm({ initial }: { initial: FiadoUpdateInput }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FiadoUpdateInput>({
    resolver: zodResolver(fiadoUpdateSchema),
    defaultValues: initial,
  });

  async function onSubmit(values: FiadoUpdateInput) {
    setSaving(true);
    const res = await atualizarFiado({ ...values, id: initial.id });
    setSaving(false);
    if (res.ok) {
      toast.success("Conta atualizada");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dueDate">Vencimento</Label>
          <Input
            id="dueDate"
            type="date"
            {...register("dueDate", { setValueAs: (v) => (v === "" ? null : v) })}
          />
          {errors.dueDate && (
            <span className="text-xs text-destructive">{errors.dueDate.message}</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerPhone">Telefone do cliente</Label>
          <Controller
            control={control}
            name="customerPhone"
            render={({ field }) => (
              <PhoneInput
                id="customerPhone"
                value={field.value ?? ""}
                onChange={(v) => field.onChange(v || null)}
                onBlur={field.onBlur}
              />
            )}
          />
          {errors.customerPhone && (
            <span className="text-xs text-destructive">{errors.customerPhone.message}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Observação</Label>
        <Input
          id="notes"
          {...register("notes", { setValueAs: (v) => (v === "" ? null : v) })}
        />
        {errors.notes && (
          <span className="text-xs text-destructive">{errors.notes.message}</span>
        )}
      </div>

      <Button type="submit" variant="outline" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Salvar dados da conta
      </Button>
    </form>
  );
}
