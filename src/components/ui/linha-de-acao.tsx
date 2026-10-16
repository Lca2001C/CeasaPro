import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconeRedondo, type TomDeIcone } from "./icone-redondo";

/**
 * Lista de linhas tocáveis num cartão só, separadas por um fio — o "menu de
 * conta" do app: cada linha é um destino, com ícone, título, um detalhe
 * opcional e a seta à direita dizendo "isto abre".
 *
 * A linha INTEIRA é o alvo (link ou botão), com no mínimo 64px de altura: não
 * existe um pedaço que não responda ao toque. O nome acessível é o próprio
 * texto da linha; o ícone e a seta são decoração (`aria-hidden`).
 */
export function ListaDeAcoes({
  className,
  titulo,
  children,
}: {
  className?: string;
  /** Título da seção, acima do cartão (opcional). */
  titulo?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {titulo && (
        <h2 className="px-1 text-sm font-semibold text-muted-foreground">{titulo}</h2>
      )}
      <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-suave">
        {children}
      </ul>
    </section>
  );
}

type Destino =
  | { href: string; onClick?: never; type?: never }
  | { href?: never; onClick: () => void; type?: "button" };

export type LinhaDeAcaoProps = Destino & {
  icone?: React.ReactNode;
  /** Tom do círculo do ícone. Semântico só para estado. */
  tom?: TomDeIcone;
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  /** Valor ou selo à direita, antes da seta (ex.: "R$ 120,00", "3 vencidas"). */
  complemento?: React.ReactNode;
  /** Sem seta: para ações que não navegam (abrir modal, alternar). */
  semSeta?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function LinhaDeAcao({
  icone,
  tom,
  titulo,
  descricao,
  complemento,
  semSeta,
  className,
  ...destino
}: LinhaDeAcaoProps) {
  const conteudo = (
    <>
      {icone && <IconeRedondo tom={tom}>{icone}</IconeRedondo>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold leading-snug [overflow-wrap:anywhere]">{titulo}</span>
        {descricao && (
          <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {descricao}
          </span>
        )}
      </span>
      {complemento && (
        <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
          {complemento}
        </span>
      )}
      {!semSeta && (
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  const classe = cn(
    "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left outline-none motion-safe:transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    className,
  );

  return (
    <li>
      {destino.href !== undefined ? (
        <Link href={destino.href} className={classe} aria-label={destino["aria-label"]}>
          {conteudo}
        </Link>
      ) : (
        <button
          type="button"
          onClick={destino.onClick}
          className={classe}
          aria-label={destino["aria-label"]}
        >
          {conteudo}
        </button>
      )}
    </li>
  );
}
