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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function LoginForm() {
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
    const next = params.get("next");
    const redirectTo = res.data.mustChangePassword
      ? "/alterar-senha"
      : safeRedirectPath(next, res.data.redirectTo);
    router.push(redirectTo);
    router.refresh();
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
      </CardContent>
    </Card>
  );
}
