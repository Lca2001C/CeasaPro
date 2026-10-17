import { ExternalLink } from "lucide-react";
import { NOTICIA_TEMA_LABELS } from "@/lib/labels";
import { idadeDaNoticia } from "@/lib/noticias/tempo";
import type { NoticiaDaTela } from "@/lib/services/noticias.service";

/**
 * Uma notícia: título, veículo, idade e um resumo curto, com link para a
 * matéria no site de quem publicou. Tudo é TEXTO (o parser já tirou o HTML do
 * feed); a imagem vem do próprio veículo, sempre `https:`.
 */
export function CartaoDeNoticia({
  noticia,
  familias = [],
}: {
  noticia: NoticiaDaTela;
  /** Produtos da empresa citados — viram a marca "sobre: Tomate". */
  familias?: string[];
}) {
  return (
    <a
      href={noticia.url}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <article className="flex h-full gap-3 rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/60 hover:bg-accent/40">
        {noticia.imagemUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- imagem de terceiro, sem otimizador
          <img
            src={noticia.imagemUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-20 shrink-0 rounded-md bg-muted object-cover sm:size-24"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            <span className="max-w-[60%] truncate font-semibold text-foreground/80">{noticia.fonte}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={noticia.publicadaEm.toISOString()}>{idadeDaNoticia(noticia.publicadaEm)}</time>
          </p>
          <h3 className="line-clamp-3 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
            {noticia.titulo}
          </h3>
          {noticia.resumo && (
            <p className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{noticia.resumo}</p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
            {familias.map((f) => (
              <span
                key={f}
                className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success"
              >
                sobre: {f}
              </span>
            ))}
            {noticia.temas.map((t) => (
              <span
                key={t}
                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {NOTICIA_TEMA_LABELS[t] ?? t}
              </span>
            ))}
            <ExternalLink className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-label="abre o site do veículo" />
          </div>
        </div>
      </article>
    </a>
  );
}
