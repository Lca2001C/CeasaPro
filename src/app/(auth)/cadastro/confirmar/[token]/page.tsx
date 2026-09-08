import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, TriangleAlert, UserPlus } from "lucide-react";
import { SignupService } from "@/lib/services/signup.service";
import { TRIAL_DAYS } from "@/lib/billing/status";
import { AppError } from "@/lib/http/app-error";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// O token vem na URL e é consultado no banco: nunca pode ser pré-renderizado
// nem ficar em cache (nem no CDN). Também é o que garante o nonce do CSP.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirmar e-mail",
  robots: { index: false, follow: false },
};

const dataBR = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(d);

/**
 * Confirma o e-mail e libera o teste grátis.
 *
 * A confirmação acontece no GET, e não atrás de um botão, porque é o que o
 * usuário espera de um link de e-mail. `SignupService.confirmEmail` é idempotente
 * e não renovável justamente para suportar isso: robô de e-mail que pré-carrega o
 * link não estraga a experiência, e reabrir o link não estende o teste.
 */
export default async function ConfirmarPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let trialEndsAt: Date | null = null;
  let erro: string | null = null;
  let codigo: string | null = null;

  try {
    const res = await SignupService.confirmEmail(token);
    trialEndsAt = res.trialEndsAt;
  } catch (e) {
    if (e instanceof AppError) {
      erro = e.message;
      codigo = e.code;
    } else {
      // Falha inesperada não pode virar "link inválido": isso mandaria a pessoa
      // se cadastrar de novo (e falhar por e-mail duplicado) por um problema
      // nosso. A mensagem é honesta e o erro fica no log.
      logger.error({ err: e instanceof Error ? e.message : String(e) }, "Falha ao confirmar e-mail");
      erro = "Não foi possível confirmar agora. Tente novamente em alguns minutos.";
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {trialEndsAt ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="size-8 text-primary" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">E-mail confirmado!</p>
              <p className="text-sm text-muted-foreground">
                Seus {TRIAL_DAYS} dias de teste começaram. Você tem acesso completo até{" "}
                <strong className="text-foreground">{dataBR(trialEndsAt)}</strong>.
              </p>
              <p className="text-xs text-muted-foreground">
                Sem cobrança automática: nada acontece se você não contratar.
              </p>
            </div>
            <Button asChild size="lg" className="w-full">
              {/*
                Passa pela renovação em vez de ir direto ao /login.

                Quem entrou ANTES de clicar no link carrega um token que ainda
                diz SUSPENSO — a confirmação libera o trial no banco, não no
                cookie. Indo ao /login, o proxy via a sessão, mandava para o
                /dashboard e o token velho derrubava a pessoa em
                /conta/suspensa: "seu teste grátis terminou" no primeiro dia.
                A rota reemite o cookie a partir do banco; sem sessão, ela
                mesma devolve ao /login com o destino preservado.

                `<a>` e não `<Link>`: a rota exige navegação de topo, e a
                transição do router seria um fetch RSC.
              */}
              <a href="/api/auth/renovar?next=%2Fdashboard">Entrar no CeasaPro</a>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <TriangleAlert className="size-8 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                {codigo === "TOKEN_REENVIADO" ? "Esse link expirou" : "Não foi possível confirmar"}
              </p>
              <p className="text-sm text-muted-foreground">{erro}</p>
            </div>
            {/*
              Link expirado agora dispara um e-mail novo (ver `confirmEmail`),
              então "fazer o cadastro" seria mandar a pessoa para um caminho
              que não faz nada: o cadastro vê o e-mail em uso e não reemite.
              O que resta é abrir o e-mail que acabou de chegar.
            */}
            {codigo === "TOKEN_REENVIADO" ? (
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
                Já tenho conta
              </Link>
            ) : (
              <>
                <Button asChild size="lg" className="w-full">
                  <Link href="/cadastro">
                    <UserPlus className="size-4" />
                    Fazer o cadastro
                  </Link>
                </Button>
                <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
                  Já tenho conta
                </Link>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
