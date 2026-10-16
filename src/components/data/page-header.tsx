import * as React from "react";

interface Props {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * Os `data-tour` são as âncoras do tour guiado (ver `lib/tour/roteiro`).
 *
 * Ficam aqui, e não em cada página, porque este cabeçalho é o único elemento
 * que TODA tela tem: uma marcação neste arquivo dá ao tour um ponto de destaque
 * em qualquer rota, sem espalhar atributos por vinte páginas nem exigir que uma
 * tela nova se lembre de participar.
 */
export function PageHeader({ title, description, action }: Props) {
  return (
    // No celular o título vem em cima e as ações embaixo, livres para quebrar
    // linha: lado a lado, dois botões em pílula não cabem em 320px.
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div data-tour="titulo-da-tela" className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex shrink-0 flex-wrap gap-2" data-tour="acao-da-tela">
          {action}
        </div>
      )}
    </div>
  );
}
