import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * `data-slot="card"` é o gancho para teste, e existe porque a CLASSE não serve.
 *
 * `bg-card` era a assinatura usada pelos testes de layout, mas o `cn`
 * (tailwind-merge) a REMOVE quando quem chama passa outro fundo — e vários
 * cartões passam: `bg-destructive/5` na despesa vencida, `bg-warning/10` nas
 * caixas perdidas, `bg-accent/40` na ajuda. Esses cartões simplesmente não
 * eram encontrados: um teste que seleciona `.bg-card` falha ao procurá-los, e
 * a varredura de vazamento em 320px os ignorava em silêncio — deixando de
 * fora justamente os cartões de destaque, que são os mais cheios de texto.
 */
function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("font-semibold leading-tight tracking-tight", className)} {...props} />
  );
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-4 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
