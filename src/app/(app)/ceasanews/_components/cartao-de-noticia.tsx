import type { NoticiaTema } from "@prisma/client";
import {
  BadgeDollarSign,
  CloudRain,
  Landmark,
  Newspaper,
  Store,
  Truck,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { NOTICIA_TEMA_LABELS } from "@/lib/labels";
import { idadeDaNoticia } from "@/lib/noticias/tempo";
import type { NoticiaDaTela } from "@/lib/services/noticias.service";

/**
 * Cartões do CeasaNews no formato de portal de notícias (referência: g1):
 * imagem grande à esquerda, título forte em cor de destaque, uma linha de
 * resumo e "Há X minutos — Em Veículo".
 *
 * Tudo é TEXTO (o parser já tirou o HTML do feed) e todo cartão é um link
 * para a matéria no site de quem publicou.
 */

const ICONE_DO_TEMA: Record<NoticiaTema, LucideIcon> = {
  CEASA: Store,
  PRECOS: BadgeDollarSign,
  CLIMA: CloudRain,
  LOGISTICA: Truck,
  SAFRA: Wheat,
  ECONOMIA: Landmark,
};

/**
 * A imagem do cartão, em três níveis:
 *  1. a foto da própria matéria, quando o feed manda (g1, Canal Rural…);
 *  2. a foto do produto citado, do Banco de fotos — com a marca "Imagem
 *     ilustrativa", porque NÃO é a foto da notícia;
 *  3. sem nenhuma das duas, um quadro com o ícone do assunto.
 * O Google Notícias, que traz a maior parte das notícias, não manda imagem.
 */
function ImagemDaNoticia({
  noticia,
  ilustracao,
  compacta = false,
  className,
}: {
  noticia: NoticiaDaTela;
  ilustracao: string | null;
  compacta?: boolean;
  className?: string;
}) {
  const src = noticia.imagemUrl ?? ilustracao;
  if (src) {
    return (
      <div className={cn("relative overflow-hidden rounded-xl bg-muted", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- imagem de terceiro, sem otimizador */}
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {!noticia.imagemUrl && !compacta && (
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Imagem ilustrativa
          </span>
        )}
      </div>
    );
  }
  const tema = noticia.temas[0];
  const Icone = tema ? ICONE_DO_TEMA[tema] : Newspaper;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-primary",
        className,
      )}
    >
      <Icone className={compacta ? "size-7" : "size-12"} strokeWidth={1.5} />
      {!compacta && tema && (
        <span className="text-xs font-bold uppercase tracking-widest opacity-80">
          {NOTICIA_TEMA_LABELS[tema]}
        </span>
      )}
    </div>
  );
}

function Meta({ noticia, className }: { noticia: NoticiaDaTela; className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      <time dateTime={noticia.publicadaEm.toISOString()}>{idadeDaNoticia(noticia.publicadaEm)}</time>
      {" — Em "}
      <span className="font-medium">{noticia.fonte}</span>
    </p>
  );
}

/** Notícia da coluna principal: imagem à esquerda, texto à direita. */
export function CartaoDeNoticia({
  noticia,
  ilustracao = null,
  familias = [],
}: {
  noticia: NoticiaDaTela;
  ilustracao?: string | null;
  /** Produtos da empresa citados — viram a marca "Sobre: Tomate". */
  familias?: string[];
}) {
  return (
    <a
      href={noticia.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group grid grid-cols-1 gap-3 py-5 first:pt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,45%)_1fr] sm:gap-5"
    >
      <ImagemDaNoticia noticia={noticia} ilustracao={ilustracao} className="aspect-video w-full" />
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-lg font-bold leading-tight text-primary [overflow-wrap:anywhere] group-hover:underline sm:text-xl lg:text-2xl">
          {noticia.titulo}
        </h3>
        {noticia.resumo && (
          <p className="flex gap-2 text-sm text-foreground/80">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{noticia.resumo}</span>
          </p>
        )}
        <Meta noticia={noticia} />
        {(familias.length > 0 || noticia.temas.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {familias.map((f) => (
              <span
                key={f}
                className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success"
              >
                Sobre: {f}
              </span>
            ))}
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
    </a>
  );
}

/** Item da coluna lateral ("Leia também" do g1): título à esquerda, miniatura à direita. */
export function ItemLateral({
  noticia,
  ilustracao = null,
}: {
  noticia: NoticiaDaTela;
  ilustracao?: string | null;
}) {
  return (
    <a
      href={noticia.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 py-4 first:pt-0 last:pb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="line-clamp-4 text-sm font-bold leading-snug text-primary [overflow-wrap:anywhere] group-hover:underline">
          {noticia.titulo}
        </h3>
        <Meta noticia={noticia} className="text-[11px]" />
      </div>
      <ImagemDaNoticia noticia={noticia} ilustracao={ilustracao} compacta className="size-20 shrink-0 sm:size-24" />
    </a>
  );
}
