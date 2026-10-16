import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, TriangleAlert } from "lucide-react";
import { findUserByResetToken } from "@/lib/auth/password-reset";
import { maskEmail } from "@/lib/auth/reset-token";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconeRedondo } from "@/components/ui/icone-redondo";
import { ResetForm } from "./_components/reset-form";

// O token vem na URL e é consultado no banco: nunca pode ser pré-renderizado
// nem ficar em cache (nem no CDN).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Redefinir senha",
  robots: { index: false, follow: false },
};

/**
 * Valida o token NO SERVIDOR antes de mostrar o formulário. Sem isto o usuário
 * digita a senha duas vezes para só então descobrir que o link expirou.
 */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await findUserByResetToken(token);

  return (
    <Card>
      <CardContent className="p-5 sm:p-7">
        {user ? (
          <ResetForm token={token} maskedEmail={maskEmail(user.email)} />
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <IconeRedondo tom="destructive" tamanho="lg">
              <TriangleAlert />
            </IconeRedondo>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-bold tracking-tight">Link inválido ou expirado</h2>
              <p className="text-sm text-muted-foreground">
                O link de redefinição vale por 1 hora e só pode ser usado uma vez. Peça
                um novo para continuar.
              </p>
            </div>
            <Button asChild size="lg" className="w-full">
              <Link href="/recuperar-senha">
                <KeyRound className="size-4" />
                Pedir um link novo
              </Link>
            </Button>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Voltar para o login
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
