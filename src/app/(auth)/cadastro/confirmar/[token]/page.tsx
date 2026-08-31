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

  try {
    const res = await SignupService.confirmEmail(token);
    trialEndsAt = res.trialEndsAt;
  } catch (e) {
    if (e instanceof AppError) {
      erro = e.message;
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
              <Link href="/login">Entrar no CeasaPro</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <TriangleAlert className="size-8 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">Não foi possível confirmar</p>
              <p className="text-sm text-muted-foreground">{erro}</p>
            </div>
            <Button asChild size="lg" className="w-full">
              <Link href="/cadastro">
                <UserPlus className="size-4" />
                Fazer o cadastro
              </Link>
            </Button>
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
              Já tenho conta
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
