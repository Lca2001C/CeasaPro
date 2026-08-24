"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, MailCheck } from "lucide-react";
import { forgotSchema, type ForgotInput } from "@/lib/validations/auth";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm() {
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotInput>({ resolver: zodResolver(forgotSchema) });

  async function onSubmit(values: ForgotInput) {
    setLoading(true);
    const res = await apiPost<{ message: string }>("/api/auth/forgot", values);
    setLoading(false);
    if (res.ok) {
      setSentTo(values.email);
      toast.success("Se o e-mail existir, enviaremos as instruções.");
    } else {
      toast.error(res.error.message);
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <MailCheck className="size-8 text-primary" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Verifique seu e-mail</p>
          <p className="text-sm text-muted-foreground">
            Se <strong className="text-foreground">{sentTo}</strong> tiver uma conta
            ativa, o link de redefinição chega em instantes. Ele vale por 1 hora.
          </p>
          <p className="text-xs text-muted-foreground">
            Não achou? Confira a caixa de spam / lixo eletrônico.
          </p>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void onSubmit({ email: sentTo })}
          disabled={loading}
        >
          {loading && <Loader2 className="animate-spin" />}
          Enviar novamente
        </Button>
        <Link href="/login" className="text-sm font-medium text-primary underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Informe o e-mail da conta. Enviaremos um link para você criar uma senha nova.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-mail da conta</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          {...register("email")}
        />
        {errors.email && (
          <span className="text-xs text-destructive">{errors.email.message}</span>
        )}
      </div>
      <Button type="submit" size="lg" disabled={loading}>
        {loading && <Loader2 className="animate-spin" />}
        Enviar link
      </Button>
      <Link
        href="/login"
        className="text-center text-sm text-muted-foreground hover:text-foreground"
      >
        Voltar para o login
      </Link>
    </form>
  );
}
