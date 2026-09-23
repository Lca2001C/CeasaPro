import Link from "next/link";
import { AlertTriangle, CheckCircle2, CreditCard } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { motivoDoBloqueio } from "@/lib/billing/status";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default async function ContaSuspensaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Três causas diferentes, três textos. Mandar "regularize seu pagamento" para
  // quem acabou de terminar o teste grátis (e nunca teve mensalidade) soa como
  // cobrança de uma dívida que não existe.
  const [sub, tenant, user] = await Promise.all([
    session.tenantId
      ? prisma.tenantSubscription.findUnique({
          where: { tenantId: session.tenantId },
          select: { activatedAt: true, trialEndsAt: true, cancelledAt: true, statusSource: true },
        })
      : null,
    session.tenantId
      ? prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { status: true } })
      : null,
    prisma.user.findUnique({ where: { id: session.sub }, select: { emailVerifiedAt: true } }),
  ]);
  // A decisão sai das DATAS e mora em `motivoDoBloqueio`, com teste próprio.
  const motivo = motivoDoBloqueio(sub, new Date(), tenant?.status === "ACTIVE");
  const testeAtivo = motivo === "teste_ativo";
  const nuncaAtivou = motivo !== "bloqueado";
  // Cadastro público que não confirmou o e-mail: o teste de 7 dias AINDA está
  // disponível. Mandar pagar a 1ª mensalidade tirava dele o teste que é dele —
  // o e-mail de confirmação caiu no spam, ou o SMTP falhou. A recuperação de
  // senha comprova a caixa do mesmo jeito e libera o teste (`consumeResetToken`).
  const emailPendente = motivo === "nunca_ativou" && user?.emailVerifiedAt === null;

  const conteudo = emailPendente
    ? {
        titulo: "Confirme seu e-mail",
        texto:
          "Seu teste grátis de 7 dias começa quando você confirma o e-mail. Abra o link que " +
          "enviamos no cadastro (confira também a caixa de spam). Não recebeu? Peça um link " +
          "para criar uma senha nova: ele confirma o e-mail e libera o teste na hora.",
        cta: "Receber um link por e-mail",
        href: "/recuperar-senha",
        documento: false,
      }
    : testeAtivo
    ? {
        titulo: "Seu teste grátis está ativo",
        texto:
          "Você tem acesso completo — esta tela apareceu porque a sua sessão foi aberta " +
          "antes da confirmação do e-mail. Entrar de novo resolve, sem pagar nada.",
        cta: "Entrar no CeasaPro",
        // Navegação de DOCUMENTO (não `<Link>`): a rota reemite o cookie a
        // partir do banco e só aceita navegação de topo.
        href: "/api/auth/renovar?next=%2Fdashboard",
        documento: true,
      }
    : motivo === "teste_terminou"
      ? {
          titulo: "Seu teste grátis terminou",
          texto:
            "Esperamos que o CeasaPro tenha ajudado. Para continuar, escolha um plano e " +
            "pague por PIX, cartão de crédito ou de débito — a liberação é automática assim " +
            "que o pagamento é aprovado. Tudo que você lançou durante o teste continua aqui.",
          cta: "Escolher plano e continuar",
          href: "/assinatura",
          documento: false,
        }
      : nuncaAtivou
        ? {
            titulo: "Ative sua assinatura",
            texto:
              "Falta só o pagamento da primeira mensalidade para liberar o CeasaPro. Você " +
              "pode pagar por PIX, cartão de crédito ou de débito — a liberação é automática " +
              "assim que o pagamento é aprovado.",
            cta: "Escolher plano e pagar",
            href: "/assinatura",
            documento: false,
          }
        : {
            titulo: "Acesso temporariamente bloqueado",
            texto:
              "Sua assinatura está pendente ou foi suspensa. Regularize o pagamento para " +
              "voltar a usar o CeasaPro. Seus dados estão preservados.",
            cta: "Regularizar / pagar mensalidade",
            href: "/assinatura",
            documento: false,
          };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
          {testeAtivo ? (
            <CheckCircle2 className="size-12 text-primary" />
          ) : nuncaAtivou ? (
            <CreditCard className="size-12 text-primary" />
          ) : (
            <AlertTriangle className="size-12 text-warning" />
          )}
          <h1 className="text-xl font-bold">{conteudo.titulo}</h1>
          <p className="text-sm text-muted-foreground">{conteudo.texto}</p>
          <Button asChild size="lg" className="w-full">
            {conteudo.documento ? (
              <a href={conteudo.href}>{conteudo.cta}</a>
            ) : (
              <Link href={conteudo.href}>{conteudo.cta}</Link>
            )}
          </Button>
          <LogoutButton variant="outline" />
        </CardContent>
      </Card>
    </div>
  );
}
