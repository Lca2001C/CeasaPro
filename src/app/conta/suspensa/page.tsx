import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default async function ContaSuspensaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
          <AlertTriangle className="size-12 text-warning" />
          <h1 className="text-xl font-bold">Acesso temporariamente bloqueado</h1>
          <p className="text-sm text-muted-foreground">
            Sua assinatura está pendente ou foi suspensa. Regularize o pagamento para
            voltar a usar o CeasaPro. Seus dados estão preservados.
          </p>
          <Button asChild size="lg" className="w-full">
            <Link href="/assinatura">Regularizar / pagar mensalidade</Link>
          </Button>
          <LogoutButton variant="outline" />
        </CardContent>
      </Card>
    </div>
  );
}
