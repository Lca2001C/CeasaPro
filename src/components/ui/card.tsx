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

/**
 * Título do cartão.
 *
 * É `<h2>`, e não `<h3>`. O motivo é a ESTRUTURA das telas: quem emite o `<h1>`
 * é o `PageHeader`, e os cartões são as seções imediatamente abaixo dele. Com
 * `<h3>` o documento pulava de h1 para h3 — o axe acusava `heading-order` em
 * `/configuracoes`, `/plano` e `/assinatura`, e quem navega por títulos (que é
 * como leitor de tela percorre uma página densa) via um nível inteiro faltando.
 *
 * Cartão dentro de seção que já tenha um `<h2>` continua correto: dois h2
 * seguidos não são um salto, ao contrário de h1 → h3.
 */
function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    /*
      `heading-has-content` não consegue enxergar o conteúdo aqui: os filhos
      chegam por `{...props}`, e a regra analisa o JSX sem seguir a composição.
      É falso positivo de primitivo — quem chama sempre passa texto. Desligado
      só nesta linha, e não no projeto, para que um título de verdade sem
      conteúdo continue sendo apanhado em qualquer outro arquivo.
    */
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h2 className={cn("font-semibold leading-tight tracking-tight", className)} {...props} />
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
