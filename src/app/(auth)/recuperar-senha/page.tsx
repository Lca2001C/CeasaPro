"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { forgotSchema, type ForgotInput } from "@/lib/validations/auth";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function ForgotPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
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
      setSent(true);
      toast.success("Se o e-mail existir, enviaremos as instruções.");
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {sent ? (
          <div className="flex flex-col gap-4 text-center">
            <p className="text-sm">
              Enviamos um link de redefinição para o seu e-mail (verifique também o
              spam).
            </p>
            <Link href="/login" className="text-sm font-medium text-primary underline">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">E-mail da conta</Label>
              <Input id="email" type="email" autoFocus {...register("email")} />
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
        )}
      </CardContent>
    </Card>
  );
}
