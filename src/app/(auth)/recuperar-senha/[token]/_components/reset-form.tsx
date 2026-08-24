"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { passwordPolicy } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z
  .object({
    password: passwordPolicy,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não conferem",
    path: ["confirm"],
  });
type FormValues = z.infer<typeof schema>;

export function ResetForm({ token, maskedEmail }: { token: string; maskedEmail: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  // Token queimado no servidor (expirou, ou o link já foi usado em outra aba).
  const [expired, setExpired] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setLoading(true);
    const res = await apiPost("/api/auth/reset", { token, password: values.password });
    setLoading(false);
    if (res.ok) {
      toast.success("Senha redefinida! Entre com a senha nova.");
      router.push("/login");
      return;
    }
    if (res.error.code === "INVALID_TOKEN") setExpired(true);
    toast.error(res.error.message);
  }

  if (expired) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className="text-sm">
          Este link não é mais válido — ele vale por 1 hora e só pode ser usado uma vez.
        </p>
        <Button asChild size="lg">
          <Link href="/recuperar-senha">Pedir um link novo</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Definindo a nova senha da conta <strong className="text-foreground">{maskedEmail}</strong>.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Nova senha</Label>
        <div className="relative">
          <Input
            id="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            className="pr-10"
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.password ? (
          <span className="text-xs text-destructive">{errors.password.message}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Ao menos 8 caracteres, com uma letra e um número.
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Confirmar nova senha</Label>
        <Input
          id="confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          {...register("confirm")}
        />
        {errors.confirm && (
          <span className="text-xs text-destructive">{errors.confirm.message}</span>
        )}
      </div>
      <Button type="submit" size="lg" disabled={loading}>
        {loading && <Loader2 className="animate-spin" />}
        Redefinir senha
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Ao redefinir, todos os dispositivos conectados serão desconectados.
      </p>
    </form>
  );
}
