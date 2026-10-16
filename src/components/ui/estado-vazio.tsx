import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconeRedondo } from "./icone-redondo";

/**
 * "Ainda não tem nada aqui" — e o que fazer a respeito.
 *
 * Cartão claro (não mais a caixa tracejada), ícone num círculo suave, uma
 * frase que diz o que falta e, quando existe, a ação que resolve. Tela vazia
 * sem caminho é tela morta.
 */
export function EstadoVazio({
  titulo,
  descricao,
  icone,
  acao,
  className,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  icone?: React.ReactNode;
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border border-border/60 bg-card px-6 py-10 text-center text-card-foreground shadow-suave",
        className,
      )}
    >
      <IconeRedondo tom="neutro" tamanho="lg" className="mb-3">
        {icone ?? <Inbox />}
      </IconeRedondo>
      <p className="text-base font-semibold">{titulo}</p>
      {descricao && <p className="max-w-sm text-sm text-muted-foreground">{descricao}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}
