import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { valorExibivel } from "@/lib/format";
import { IconeRedondo, type TomDeIcone } from "./icone-redondo";

/**
 * Cartão de resumo: um rótulo, UM número grande e, se quiser, uma dica.
 *
 * Hierarquia de propósito simples — o número é a única coisa grande do
 * cartão. `tabular-nums` para os dígitos não dançarem quando o valor muda, e
 * `overflow-wrap:anywhere` para que um valor na casa dos milhões quebre linha
 * em vez de vazar da caixa num celular de 320px.
 *
 * - `destaque`: o cartão "principal do dia", em verde cheio com texto branco
 *   (o par branco/primary já medido em AA no teste de contraste).
 * - `href`: o cartão inteiro vira link, com seta.
 */
export function CardDeResumo({
  rotulo,
  valor,
  dica,
  icone,
  tom = "primary",
  tomDoValor,
  destaque = false,
  href,
  className,
}: {
  rotulo: string;
  valor: string;
  dica?: React.ReactNode;
  icone?: React.ReactNode;
  tom?: TomDeIcone;
  /** Cor do número — só para estado (lucro negativo, conta vencida). */
  tomDoValor?: "success" | "warning" | "destructive";
  destaque?: boolean;
  href?: string;
  className?: string;
}) {
  const corDoValor = destaque
    ? "text-primary-foreground"
    : tomDoValor === "success"
      ? "text-success"
      : tomDoValor === "warning"
        ? "text-warning"
        : tomDoValor === "destructive"
          ? "text-destructive"
          : "text-foreground";

  const corpo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "min-w-0 text-sm font-medium [overflow-wrap:anywhere]",
            destaque ? "text-primary-foreground/90" : "text-muted-foreground",
          )}
        >
          {rotulo}
        </span>
        {icone &&
          (destaque ? (
            <span
              aria-hidden
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15 text-primary-foreground [&_svg]:size-5"
            >
              {icone}
            </span>
          ) : (
            <IconeRedondo tom={tom}>{icone}</IconeRedondo>
          ))}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span
          className={cn(
            "min-w-0 text-[1.75rem] font-bold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere] sm:text-3xl",
            corDoValor,
          )}
        >
          {valorExibivel(valor)}
        </span>
        {href && (
          <ChevronRight
            aria-hidden
            className={cn(
              "mb-1 size-5 shrink-0",
              destaque ? "text-primary-foreground/80" : "text-muted-foreground",
            )}
          />
        )}
      </div>
      {dica && (
        <div
          className={cn(
            "mt-1 text-sm",
            destaque ? "text-primary-foreground/90" : "text-muted-foreground",
          )}
        >
          {dica}
        </div>
      )}
    </>
  );

  const classe = cn(
    "block rounded-lg border p-5 shadow-suave",
    destaque
      ? "border-transparent bg-primary text-primary-foreground"
      : "border-border/60 bg-card text-card-foreground",
    href &&
      "outline-none motion-safe:transition-shadow hover:shadow-elevada focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    className,
  );

  return href ? (
    <Link href={href} className={classe} data-slot="card">
      {corpo}
    </Link>
  ) : (
    <div className={classe} data-slot="card">
      {corpo}
    </div>
  );
}
