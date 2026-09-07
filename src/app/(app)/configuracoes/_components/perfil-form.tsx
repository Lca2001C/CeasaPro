"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { perfilSchema, type PerfilInput } from "@/lib/validations/config";
import { salvarPerfil } from "@/actions/config.actions";
import { renovarSessao } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PerfilConfigForm({ initial, email }: { initial: PerfilInput; email: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PerfilInput>({ resolver: zodResolver(perfilSchema), defaultValues: initial });

  async function onSubmit(values: PerfilInput) {
    setSaving(true);
    const res = await salvarPerfil(values);
    if (res.ok) {
      // O cabeçalho lê o nome do claim `name` do JWT, não do banco. Sem renovar,
      // ele continuaria mostrando o nome antigo por até o TTL do access token —
      // e a pessoa concluiria que o salvamento não funcionou.
      await renovarSessao();
      toast.success("Perfil atualizado");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Seu nome</Label>
        <Input id="name" {...register("name")} />
        <span className="text-xs text-muted-foreground">
          É o nome que aparece aqui no sistema e no comprovante da mensalidade.
        </span>
        {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-mail de acesso</Label>
        <Input id="email" value={email} readOnly disabled />
        <span className="text-xs text-muted-foreground">
          Para trocar o e-mail de acesso, fale com o suporte.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Salvar
        </Button>
        <Button asChild variant="outline">
          <Link href="/alterar-senha">Alterar senha</Link>
        </Button>
      </div>
    </form>
  );
}
