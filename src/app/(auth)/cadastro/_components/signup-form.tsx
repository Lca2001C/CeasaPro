"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
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
import { Select } from "@/components/ui/select";
import { UFS } from "@/lib/constants";
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

export interface CentralParaEscolha {
  code: string;
  name: string;
  city: string;
  uf: string;
  /** Tem busca automática de boletim? Ver `CotacoesService.listarCentrais`. */
  automatica: boolean;
}

export function SignupForm({
  trialDays,
  centrais,
}: {
  trialDays: number;
  centrais: CentralParaEscolha[];
}) {
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  // A lista de centrais segue a UF escolhida. Sem isso seriam ~65 opções numa
  // lista só — no celular, rolar até achar a sua é pior que dois toques.
  // `useWatch` e não `watch()`: o segundo devolve uma função que o compilador do
  // React não consegue memoizar, e o lint reprova com razão.
  const uf = useWatch({ control, name: "uf" });
  const daUf = centrais.filter((c) => c.uf === uf);
  const automaticasDaUf = daUf.filter((c) => c.automatica);
  const manuaisDaUf = daUf.filter((c) => !c.automatica);

  /*
    Trocar de estado limpa a central escolhida.

    Sem isso o formulário enviaria uma central de OUTRO estado — que o servidor
    aceitaria, porque ela existe de verdade — e o cliente passaria a ver os
    preços da praça errada, sem nada indicando o engano.

    Feito no `onChange` e não durante o render: mexer no estado da biblioteca de
    formulário enquanto ele renderiza é efeito colateral no meio do render, e o
    lint aponta com razão.
  */
  const campoUf = register("uf");

  async function onSubmit(values: FormValues) {
    // Só os campos do contrato da API — `confirm` não atravessa a rede.
    // Anotar como `SignupInput` faz o TypeScript apontar aqui se um campo novo
    // entrar no schema, em vez de deixá-lo silenciosamente de fora do envio.
    const payload: SignupInput = {
      email: values.email,
      password: values.password,
      // Vazio vira `undefined`: o schema trata ausência como "não informou", e
      // mandar string vazia faria a UF cair na validação da lista fechada.
      uf: values.uf || undefined,
      ceasaCentralCode: values.ceasaCentralCode || undefined,
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
            {trialDays} dias grátis para testar tudo. Não pedimos cartão de crédito. Os
            dados da sua empresa você preenche depois, quando quiser.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
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

          {/*
            Estado e central: dois toques, não dois campos de digitação.

            É o que faz o módulo de Cotações já ter o que mostrar no primeiro
            acesso. Ficam opcionais de propósito — quem não sabe segue em frente
            e resolve em Configurações; travar o cadastro por causa deles seria
            perder o cliente por um detalhe.
          */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="uf">Estado</Label>
              <Select
                id="uf"
                {...campoUf}
                onChange={(e) => {
                  void campoUf.onChange(e);
                  setValue("ceasaCentralCode", "");
                }}
              >
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u.sigla} value={u.sigla}>
                    {u.sigla}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ceasaCentralCode">
                Onde você compra{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Select id="ceasaCentralCode" disabled={!uf} {...register("ceasaCentralCode")}>
                <option value="">
                  {uf ? "Selecione a central…" : "Escolha o estado primeiro"}
                </option>
                {/*
                  Agrupadas por ter ou não busca automática de boletim. Sem essa
                  separação, quem escolhesse uma das 57 centrais manuais só
                  descobriria que não recebe preço depois de contratar o módulo.
                */}
                {automaticasDaUf.length > 0 && (
                  <optgroup label="Com preços automáticos">
                    {automaticasDaUf.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} — {c.city}
                      </option>
                    ))}
                  </optgroup>
                )}
                {manuaisDaUf.length > 0 && (
                  <optgroup label="Sem busca automática ainda">
                    {manuaisDaUf.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} — {c.city}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
              {uf && daUf.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  Ainda não temos central cadastrada neste estado. Fale com o suporte que
                  incluímos a sua.
                </span>
              )}
            </div>
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
