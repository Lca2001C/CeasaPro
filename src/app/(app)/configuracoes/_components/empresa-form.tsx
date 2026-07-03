"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { empresaSchema, type EmpresaInput } from "@/lib/validations/config";
import { salvarEmpresa } from "@/actions/config.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EmpresaConfigForm({ initial }: { initial: EmpresaInput }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmpresaInput>({ resolver: zodResolver(empresaSchema), defaultValues: initial });

  async function onSubmit(values: EmpresaInput) {
    setSaving(true);
    const res = await salvarEmpresa(values);
    setSaving(false);
    if (res.ok) {
      toast.success("Dados atualizados");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tradeName">Nome fantasia</Label>
        <Input id="tradeName" {...register("tradeName")} />
        {errors.tradeName && (
          <span className="text-xs text-destructive">{errors.tradeName.message}</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="legalName">Razão social</Label>
        <Input id="legalName" {...register("legalName")} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cnpj">CNPJ</Label>
          <Input id="cnpj" {...register("cnpj")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Telefone</Label>
          <Input id="phone" {...register("phone")} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Endereço</Label>
        <Input id="address" {...register("address")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="businessHours">Horário de funcionamento</Label>
        <Input id="businessHours" placeholder="Ex.: Seg a Sáb, 4h às 12h" {...register("businessHours")} />
      </div>
      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Salvar
      </Button>
    </form>
  );
}
