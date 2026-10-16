"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import { forgotSchema, type ForgotInput } from "@/lib/validations/auth";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconeRedondo } from "@/components/ui/icone-redondo";

const linkDiscreto =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

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
        <IconeRedondo tamanho="lg">
          <MailCheck />
        </IconeRedondo>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-bold tracking-tight">Verifique seu e-mail</h2>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            Se <strong className="text-foreground">{sentTo}</strong> tiver uma conta
            ativa, o link de redefinição chega em instantes. Ele vale por 1 hora.
          </p>
          <p className="text-sm text-muted-foreground">
            Não achou? Confira a caixa de spam / lixo eletrônico.
          </p>
        </div>
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => void onSubmit({ email: sentTo })}
          disabled={loading}
        >
          {loading && <Loader2 className="motion-safe:animate-spin" />}
          Enviar novamente
        </Button>
        <Link href="/login" className={linkDiscreto}>
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconeRedondo>
          <KeyRound />
        </IconeRedondo>
        <h2 className="text-xl font-bold tracking-tight">Esqueceu a senha?</h2>
      </div>
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
          <span className="text-sm text-destructive">{errors.email.message}</span>
        )}
      </div>
      <Button type="submit" size="lg" disabled={loading} className="mt-1 w-full">
        {loading && <Loader2 className="motion-safe:animate-spin" />}
        Enviar link
      </Button>
      <Link
        href="/login"
        className={`mx-auto ${linkDiscreto}`}
      >
        Voltar para o login
      </Link>
    </form>
  );
}
