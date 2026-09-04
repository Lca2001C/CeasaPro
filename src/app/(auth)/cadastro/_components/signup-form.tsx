"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { signupSchema, type SignupInput } from "@/lib/validations/auth";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { BotaoGoogle } from "@/components/auth/botao-google";

/**
 * Schema do FORMULÁRIO = schema da API + confirmação de senha.
 *
 * A confirmação existe só para pegar erro de digitação, e aqui ela importa mais
 * que nas outras telas: quem se cadastra ainda não confirmou o e-mail, então uma
 * senha digitada errada deixa a pessoa sem entrar e sem caminho óbvio de volta.
 *
 * Ela NÃO é enviada ao servidor: lá as duas seriam necessariamente iguais (ou o
 * cliente mentiu, e comparar não protegeria de nada). Mesmo desenho já usado em
 * `alterar-senha` e na redefinição por link.
 */
const formSchema = signupSchema
  .extend({ confirm: z.string().min(1, "Repita a senha") })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não conferem",
    path: ["confirm"],
  });
type FormValues = z.infer<typeof formSchema>;

export function SignupForm({ trialDays }: { trialDays: number }) {
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  async function onSubmit(values: FormValues) {
    // Só os campos do contrato da API — `confirm` não atravessa a rede.
    // Anotar como `SignupInput` faz o TypeScript apontar aqui se um campo novo
    // entrar no schema, em vez de deixá-lo silenciosamente de fora do envio.
    const payload: SignupInput = {
      tradeName: values.tradeName,
      email: values.email,
      phone: values.phone,
      establishmentType: values.establishmentType,
      password: values.password,
    };

    setLoading(true);
    const res = await apiPost<{ message: string }>("/api/auth/signup", payload);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    // A resposta é a mesma para e-mail novo e e-mail que já tem conta — o
    // servidor não revela qual é o caso (ver `SignupService`). A tela reflete
    // isso: fala do link enviado, não de conta criada.
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
          <MailCheck className="size-8 text-primary" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Verifique seu e-mail</p>
            <p className="text-sm text-muted-foreground">
              Enviamos um link de confirmação para{" "}
              <strong className="text-foreground">{sentTo}</strong>. Confirme para liberar
              seus {trialDays} dias de teste.
            </p>
            <p className="text-xs text-muted-foreground">
              Não achou? Confira a caixa de spam / lixo eletrônico. O link vale por 24 horas.
            </p>
          </div>
          <Link href="/login" className="text-sm font-medium text-primary underline">
            Ir para o login
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/15 shadow-md">
      <CardContent className="pt-6">
        <div className="mb-5">
          <BotaoGoogle />
        </div>
        <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          ou cadastre com e-mail
          <span className="h-px flex-1 bg-border" />
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {trialDays} dias grátis para testar tudo. Não pedimos cartão de crédito.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tradeName">Nome do seu negócio</Label>
            <Input
              id="tradeName"
              autoComplete="organization"
              placeholder="Hortifrúti Silva"
              autoFocus
              {...register("tradeName")}
            />
            {errors.tradeName && (
              <span className="text-xs text-destructive">{errors.tradeName.message}</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && (
              <span className="text-xs text-destructive">{errors.email.message}</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Telefone / WhatsApp</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(31) 99999-9999"
              {...register("phone")}
            />
            {errors.phone && (
              <span className="text-xs text-destructive">{errors.phone.message}</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="establishmentType">
              Tipo de estabelecimento / box{" "}
              <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="establishmentType"
              placeholder="Box 42 — Pavilhão de Hortigranjeiros"
              {...register("establishmentType")}
            />
            {errors.establishmentType && (
              <span className="text-xs text-destructive">
                {errors.establishmentType.message}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Senha</Label>
            {/* Um único botão revela os DOIS campos: com duas senhas mascaradas,
                conferir se bateram é o que mais faz gente desistir do cadastro. */}
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
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
            <Label htmlFor="confirm">Confirmar senha</Label>
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

          <Button type="submit" size="lg" disabled={loading} className="shadow-md">
            {loading && <Loader2 className="animate-spin" />}
            Criar conta e testar grátis
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Ao criar a conta você aceita os{" "}
            <Link href="/termos" className="underline hover:text-foreground">
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link href="/privacidade" className="underline hover:text-foreground">
              Política de Privacidade
            </Link>
            .
          </p>

          <Link
            href="/login"
            className="text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Já tenho conta
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
