"use client";

import { useEffect, useState } from "react";
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
import { limparSnapshotNoLogout } from "@/lib/pwa/offline-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { BotaoGoogle, mensagemErroGoogle } from "@/components/auth/botao-google";

export function LoginForm({ trialDays }: { trialDays: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const avisoGoogle = mensagemErroGoogle(params.get("erro"));
  const next = safeRedirectPath(params.get("next"), "") || null;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  // Quem está na tela de login não tem sessão: o snapshot de consulta offline
  // que sobrou no aparelho é de alguém que saiu SEM tocar em "Sair" (sessão
  // expirada, senha trocada em outro aparelho, empresa bloqueada) — ou de um
  // sync que terminou depois do logout. O próximo a entrar não pode herdá-lo.
  useEffect(() => {
    void limparSnapshotNoLogout().catch(() => {});
  }, []);

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
      <CardContent className="p-5 sm:p-7">
        <h2 className="mb-5 text-xl font-bold tracking-tight">Entre na sua conta</h2>
        {avisoGoogle && (
          <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {avisoGoogle}
          </p>
        )}
        <div className="mb-5">
          <BotaoGoogle next={next} />
        </div>
        <div className="mb-5 flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          ou com e-mail
          <span className="h-px flex-1 bg-border" />
        </div>
        {/* `method="post"`: tocar "Entrar" antes da hidratação (3G do CEASA, ou
          nonce da CSP falhando) fazia o envio nativo por GET e punha a senha na
          URL — histórico do aparelho e log da Vercel. Vale para os 5 forms de (auth). */}
        <form method="post" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" autoFocus {...register("email")} />
            {errors.email && (
              <span className="text-sm text-destructive">{errors.email.message}</span>
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
              <span className="text-sm text-destructive">{errors.password.message}</span>
            )}
          </div>
          <Button type="submit" size="lg" disabled={loading} className="mt-1 w-full">
            {loading && <Loader2 className="motion-safe:animate-spin" />}
            Entrar
          </Button>
          <Link
            href="/recuperar-senha"
            className="mx-auto inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Esqueci minha senha
          </Link>
          {/* A conta criada pelo Google tem senha aleatória: o e-mail e senha
              responde "incorretos" sem dizer o porquê. */}
          <p className="text-center text-xs text-muted-foreground">
            Criou a conta pelo Google? Use o botão do Google acima.
          </p>
        </form>

        {/* Quem ainda não é cliente chega aqui com frequência: `/` redireciona
            para o login assim que existe sessão, e o link que circula por
            WhatsApp costuma ser o da tela de entrada. Sem estas duas saídas o
            visitante só teria o caminho de volta pelo botão do navegador. */}
        <div className="mt-5 flex flex-col gap-2 border-t border-border/60 pt-5">
          <p className="text-center text-sm text-muted-foreground">
            Ainda não tem conta?
          </p>
          {/* Em 320px o texto não cabe numa linha: quebra e o botão cresce. */}
          <Button
            asChild
            variant="info"
            size="lg"
            className="h-auto min-h-14 w-full whitespace-normal py-3 text-center"
          >
            <Link href="/cadastro">Criar conta — {trialDays} dias grátis</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/">Conhecer o CeasaPro</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
