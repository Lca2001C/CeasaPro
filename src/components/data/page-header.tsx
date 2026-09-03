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
    <div className="mb-4 flex items-start justify-between gap-3">
      <div data-tour="titulo-da-tela">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="shrink-0" data-tour="acao-da-tela">
          {action}
        </div>
      )}
    </div>
  );
}
