"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Copy } from "lucide-react";
import { novaEmpresaSchema, type NovaEmpresaInput } from "@/lib/validations/admin";
import { criarEmpresa } from "@/actions/admin.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";

interface Plano {
  id: string;
  name: string;
  priceMonthly: number;
}

export function EmpresaForm({ planos }: { planos: Plano[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<NovaEmpresaInput>({
    resolver: zodResolver(novaEmpresaSchema),
    defaultValues: {
      planId: planos[0]?.id ?? "",
      monthlyAmount: planos[0]?.priceMonthly ?? 0,
      trialDays: 15,
      graceDays: 5,
    },
  });

  async function onSubmit(values: NovaEmpresaInput) {
    setSaving(true);
    const res = await criarEmpresa(values);
    setSaving(false);
    if (res.ok) {
      toast.success("Empresa criada!");
      setCreated({ email: values.ownerEmail, password: res.data.tempPassword });
    } else {
      toast.error(res.error.message);
    }
  }

  if (created) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="font-medium">Empresa criada com sucesso!</p>
          <p className="text-sm text-muted-foreground">
            O e-mail de boas-vindas foi disparado quando o Resend esta configurado. Confira as
            credenciais abaixo; a senha deve ser trocada no primeiro acesso.
          </p>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div>
              <b>E-mail:</b> {created.email}
            </div>
            <div>
              <b>Senha temporaria:</b> <code>{created.password}</code>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(`E-mail: ${created.email}\nSenha: ${created.password}`);
                toast.success("Copiado");
              }}
            >
              <Copy /> Copiar
            </Button>
            <Button onClick={() => router.push("/admin/clientes")}>Concluir</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tradeName">Nome da empresa (fantasia)</Label>
        <Input id="tradeName" autoFocus {...register("tradeName")} />
        {errors.tradeName && (
          <span className="text-xs text-destructive">{errors.tradeName.message}</span>
        )}
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

      <hr />
      <p className="text-sm font-medium">Responsável (usuário dono)</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ownerName">Nome</Label>
          <Input id="ownerName" {...register("ownerName")} />
          {errors.ownerName && (
            <span className="text-xs text-destructive">{errors.ownerName.message}</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ownerEmail">E-mail</Label>
          <Input id="ownerEmail" type="email" {...register("ownerEmail")} />
          {errors.ownerEmail && (
            <span className="text-xs text-destructive">{errors.ownerEmail.message}</span>
          )}
        </div>
      </div>

      <hr />
      <p className="text-sm font-medium">Assinatura</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="planId">Plano</Label>
        <Select id="planId" {...register("planId")}>
          {planos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Mensalidade</Label>
          <Controller
            control={control}
            name="monthlyAmount"
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
            )}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trialDays">Dias grátis</Label>
          <Input id="trialDays" type="number" {...register("trialDays", { valueAsNumber: true })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="graceDays">Tolerância (dias)</Label>
          <Input id="graceDays" type="number" {...register("graceDays", { valueAsNumber: true })} />
        </div>
      </div>

      <Button type="submit" size="lg" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Criar empresa
      </Button>
    </form>
  );
}
