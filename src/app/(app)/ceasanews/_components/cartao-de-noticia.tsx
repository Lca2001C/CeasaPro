import { cn } from "@/lib/cn";
import { NOTICIA_TEMA_LABELS } from "@/lib/labels";
import { idadeDaNoticia } from "@/lib/noticias/tempo";
import { fotoDoAssunto } from "@/lib/noticias/ilustracoes";
import type { NoticiaDaTela } from "@/lib/services/noticias.service";

/**
 * Cartão de notícia do CeasaNews, no formato de portal (referência: g1): foto
 * em cima, título forte em cor de destaque, uma linha de resumo e "Há X
 * minutos — Em Veículo". Todo cartão é um link para a matéria no site de quem
 * publicou; tudo é TEXTO (o parser já tirou o HTML do feed).
 *
 * TODO cartão tem foto, em três níveis:
 *  1. a foto da própria matéria, quando o feed manda (g1, Canal Rural…);
 *  2. a foto do produto citado, do Banco de fotos;
 *  3. uma foto do assunto (mercado, chuva, caminhão, colheita…), de
 *     `public/noticias/` — ver `fotoDoAssunto`.
 * 2 e 3 levam a marca "Imagem ilustrativa": não são a foto da notícia, e o
 * leitor tem direito de saber. O Google Notícias, que traz a maior parte das
 * notícias, não manda imagem.
 */
export function CartaoDeNoticia({
  noticia,
  ilustracao = null,
  familias = [],
  className,
}: {
  noticia: NoticiaDaTela;
  /** Foto do Banco do produto citado (nível 2). */
  ilustracao?: string | null;
  /** Produtos da empresa citados — viram a marca "Sobre: Tomate". */
  familias?: string[];
  className?: string;
}) {
  const propria = noticia.imagemUrl;
  const src = propria ?? ilustracao ?? fotoDoAssunto(noticia);

  return (
    <a
      href={noticia.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- foto de terceiro ou estática, sem otimizador */}
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {!propria && (
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Imagem ilustrativa
          </span>
        )}
        {familias.length > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success-foreground shadow">
            Sobre: {familias.join(", ")}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-3 text-base font-bold leading-snug text-primary [overflow-wrap:anywhere] group-hover:underline sm:text-lg">
          {noticia.titulo}
        </h3>
        {noticia.resumo && (
          <p className="line-clamp-2 text-sm text-foreground/75 [overflow-wrap:anywhere]">
            {noticia.resumo}
          </p>
        )}
        <div className="mt-auto flex flex-col gap-2 pt-1">
          <p className="truncate text-xs text-muted-foreground">
            <time dateTime={noticia.publicadaEm.toISOString()}>
              {idadeDaNoticia(noticia.publicadaEm)}
            </time>
            {" — Em "}
            <span className="font-medium">{noticia.fonte}</span>
          </p>
          {noticia.temas.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {noticia.temas.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {NOTICIA_TEMA_LABELS[t] ?? t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </a>
  );
}
