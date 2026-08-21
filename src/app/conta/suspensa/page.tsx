import Link from "next/link";
import { AlertTriangle, CreditCard } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default async function ContaSuspensaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Empresa recém-cadastrada (nunca ativou) recebe um convite para assinar;
  // quem já foi cliente recebe um aviso de regularização. O texto muda porque a
  // causa é diferente — não há período gratuito para "expirar".
  const sub = session.tenantId
    ? await prisma.tenantSubscription.findUnique({
        where: { tenantId: session.tenantId },
        select: { activatedAt: true },
      })
    : null;
  const nuncaAtivou = sub !== null && sub.activatedAt === null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
          {nuncaAtivou ? (
            <CreditCard className="size-12 text-primary" />
          ) : (
            <AlertTriangle className="size-12 text-warning" />
          )}
          <h1 className="text-xl font-bold">
            {nuncaAtivou ? "Ative sua assinatura" : "Acesso temporariamente bloqueado"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {nuncaAtivou
              ? "Falta só o pagamento da primeira mensalidade para liberar o CeasaPro. Você pode pagar por PIX, cartão de crédito ou de débito — a liberação é automática assim que o pagamento é aprovado."
              : "Sua assinatura está pendente ou foi suspensa. Regularize o pagamento para voltar a usar o CeasaPro. Seus dados estão preservados."}
          </p>
          <Button asChild size="lg" className="w-full">
            <Link href="/assinatura">
              {nuncaAtivou ? "Escolher plano e pagar" : "Regularizar / pagar mensalidade"}
            </Link>
          </Button>
          <LogoutButton variant="outline" />
        </CardContent>
      </Card>
    </div>
  );
}
