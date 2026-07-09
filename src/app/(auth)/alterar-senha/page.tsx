"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { passwordPolicy } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual"),
    newPassword: passwordPolicy,
    confirm: z.string(),
  })
  .refine((d) => d.newPassword === d.confirm, {
    message: "As senhas nao conferem",
    path: ["confirm"],
  });

type FormValues = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setLoading(true);
    const res = await apiPost<{ redirectTo: string }>("/api/auth/change-password", {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Senha alterada com sucesso.");
    router.push(res.data.redirectTo);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currentPassword">Senha atual</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              autoFocus
              {...register("currentPassword")}
            />
            {errors.currentPassword && (
              <span className="text-xs text-destructive">{errors.currentPassword.message}</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newPassword">Nova senha</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...register("newPassword")}
            />
            {errors.newPassword && (
              <span className="text-xs text-destructive">{errors.newPassword.message}</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm">Confirmar nova senha</Label>
            <Input id="confirm" type="password" autoComplete="new-password" {...register("confirm")} />
            {errors.confirm && (
              <span className="text-xs text-destructive">{errors.confirm.message}</span>
            )}
          </div>
          <Button type="submit" size="lg" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Alterar senha
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
