/**
 * Fotos ilustrativas por ASSUNTO, para o cartão de notícia que não tem foto
 * própria nem cita produto do Banco de fotos (ver `ImagemDaNoticia`).
 *
 * Arquivos em `public/noticias/`, todos em domínio público ou CC0 (origem em
 * `src/lib/imagem/creditos-banco.ts`, mostrada em `/creditos-fotos`). Ficam no
 * próprio app, e não no R2: funcionam em qualquer ambiente e o cache é do CDN.
 *
 * Três por assunto, escolhidas pela identidade da notícia: a grade não mostra a
 * mesma foto em sequência, e a mesma notícia mostra sempre a mesma foto.
 */
import type { Tema } from "./filtro";

const POR_TEMA: Record<Tema | "GERAL", readonly string[]> = {
  CEASA: ["ceasa-1", "ceasa-2", "ceasa-3"],
  PRECOS: ["precos-1", "precos-2", "precos-3"],
  CLIMA: ["clima-1", "clima-2", "clima-3"],
  LOGISTICA: ["logistica-1", "logistica-2", "logistica-3"],
  SAFRA: ["safra-1", "safra-2", "safra-3"],
  ECONOMIA: ["economia-1", "economia-2", "economia-3"],
  GERAL: ["geral-1", "geral-2", "geral-3", "geral-4"],
};

/** Hash estável e barato de texto (djb2) — só para espalhar a escolha. */
function espalhar(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h;
}

export function fotoDoAssunto(noticia: { id: string; temas: readonly string[] }): string {
  const tema = noticia.temas.find((t): t is Tema => t in POR_TEMA) ?? "GERAL";
  const lista = POR_TEMA[tema];
  return `/noticias/${lista[espalhar(noticia.id) % lista.length]}.webp`;
}

/** Todas as fotos — para o teste conferir que cada uma existe em `public/`. */
export const TODAS_AS_FOTOS_DE_ASSUNTO = Object.values(POR_TEMA).flat();
