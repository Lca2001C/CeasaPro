"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Aceite obrigatório dos Termos de Uso e da Política de Privacidade (LGPD).
 *
 * O formulário de pagamento só é montado depois que a caixa é marcada — evita
 * depender de desabilitar o botão interno do Payment Brick, que é renderizado
 * dentro de um iframe do Mercado Pago e não aceita controle externo.
 */
export function TermsAcceptance({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (accepted: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-primary"
            checked={accepted}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-muted-foreground">
            Li e aceito os{" "}
            <Link
              href="/termos"
              target="_blank"
              className="font-medium text-primary underline underline-offset-2"
            >
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link
              href="/privacidade"
              target="_blank"
              className="font-medium text-primary underline underline-offset-2"
            >
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
