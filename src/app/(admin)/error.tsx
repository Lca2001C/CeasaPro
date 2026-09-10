"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, LayoutDashboard, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Error boundary do painel do super-admin.
 *
 * Separado do `(app)/error.tsx` porque o público e o desfecho são outros: aqui
 * quem lê é o operador da plataforma, e o que ele precisa é do `digest` para
 * cruzar com o log — não de uma frase tranquilizadora sobre os dados dele.
 *
 * A tela do admin costuma ser aberta justamente quando algo já está errado (um
 * cliente reclamou, um pagamento não caiu). Ela quebrar e não dizer nada é o
 * pior momento possível para perder o rastro.
 */
export default function ErroDoAdmin({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Erro no painel do super-admin:", error);
  }, [error]);

  return (
    <Card className="border-destructive/40 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Esta tela do painel falhou</h1>
        <p className="text-sm text-muted-foreground">
          Nenhum dado de cliente foi alterado — a falha foi na leitura.
        </p>

        {/*
          O digest vem em destaque, e não como rodapé discreto: para o operador
          ele não é "informe ao suporte", é a chave de busca no log do servidor.
        */}
        {error.digest && (
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm">{error.digest}</code>
        )}

        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()}>
            <RotateCw className="size-4" />
            Tentar de novo
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin">
              <LayoutDashboard className="size-4" />
              Voltar ao painel
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
