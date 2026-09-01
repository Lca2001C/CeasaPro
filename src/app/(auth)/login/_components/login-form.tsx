"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { apiPost } from "@/lib/api-client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { pedirPromptDeInstalacao } from "@/components/pwa/install-prompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function LoginForm({ trialDays }: { trialDays: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setLoading(true);
    const res = await apiPost<{ redirectTo: string; mustChangePassword: boolean }>("/api/auth/login", values);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    // Login deu certo: pede o convite de instalacao para a proxima tela. Quem
    // decide se ele aparece e o AppShell (respeita "Agora nao" e app instalado).
    pedirPromptDeInstalacao();

    const next = params.get("next");
    const redirectTo = res.data.mustChangePassword
      ? "/alterar-senha"
      : safeRedirectPath(next, res.data.redirectTo);
    // Sem router.refresh() aqui: ele dispara um refetch RSC da rota atual que
    // corre com o push e cancela a navegação ("Failed to fetch RSC payload").
    // O push já renderiza o destino do zero (outro route group) com a sessão nova.
    router.push(redirectTo);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" autoFocus {...register("email")} />
            {errors.email && (
              <span className="text-xs text-destructive">{errors.email.message}</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
            {errors.password && (
              <span className="text-xs text-destructive">{errors.password.message}</span>
            )}
          </div>
          <Button type="submit" size="lg" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Entrar
          </Button>
          <Link
            href="/recuperar-senha"
            className="text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Esqueci minha senha
          </Link>
        </form>

        {/* Quem ainda não é cliente chega aqui com frequência: `/` redireciona
            para o login assim que existe sessão, e o link que circula por
            WhatsApp costuma ser o da tela de entrada. Sem estas duas saídas o
            visitante só teria o caminho de volta pelo botão do navegador. */}
        <div className="mt-6 flex flex-col gap-2 border-t pt-5">
          <p className="text-center text-sm text-muted-foreground">
            Ainda não tem conta?
          </p>
          <Button asChild variant="outline" size="lg">
            <Link href="/cadastro">Criar conta — {trialDays} dias grátis</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/">Conhecer o CeasaPro</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
