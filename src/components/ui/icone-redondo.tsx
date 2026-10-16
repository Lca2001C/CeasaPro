import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Ícone dentro de um círculo de fundo suave — a marca visual das linhas, dos
 * cartões de resumo e dos estados vazios.
 *
 * O tom padrão é o verde da marca. Os tons semânticos (sucesso, aviso,
 * perigo, informação, roxo) são para ESTADO — conta vencida, estoque
 * acabando —, nunca para enfeitar. Fundo `/10` e ícone na cor cheia: o par já
 * medido em `tests/unit/contraste-de-cor.test.ts` para os selos.
 */
const iconeRedondoVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full",
  {
    variants: {
      tom: {
        primary: "bg-primary/10 text-primary",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        destructive: "bg-destructive/10 text-destructive",
        info: "bg-info/10 text-info",
        violet: "bg-violet/10 text-violet",
        neutro: "bg-muted text-muted-foreground",
      },
      tamanho: {
        sm: "size-9 [&_svg]:size-4",
        md: "size-11 [&_svg]:size-5",
        lg: "size-14 [&_svg]:size-6",
      },
    },
    defaultVariants: { tom: "primary", tamanho: "md" },
  },
);

export type TomDeIcone = NonNullable<VariantProps<typeof iconeRedondoVariants>["tom"]>;

export function IconeRedondo({
  className,
  tom,
  tamanho,
  children,
}: VariantProps<typeof iconeRedondoVariants> & {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span aria-hidden className={cn(iconeRedondoVariants({ tom, tamanho }), className)}>
      {children}
    </span>
  );
}
