import { XMLParser } from "fast-xml-parser";

/**
 * Leitura de feed RSS 2.0 / Atom. Função PURA — testada contra feeds reais
 * capturados em `tests/fixtures/noticias/` (o setup de teste bloqueia rede).
 *
 * Tudo o que sai daqui é TEXTO PURO: o HTML do resumo é desmontado e a tela
 * renderiza como texto, nunca com `dangerouslySetInnerHTML`. Feed é conteúdo
 * de terceiro; um `<script>` no resumo não pode virar código na nossa página.
 */

export interface ItemDeFeed {
  titulo: string;
  url: string;
  resumo: string;
  publicadaEm: Date;
  /** Só `https:` — é o que a CSP (`img-src https:`) deixa carregar. */
  imagemUrl: string | null;
  /** Veículo, quando o feed diz (`<source>` do Google Notícias). */
  fonte: string | null;
}

export type ResultadoDoFeed = { ok: true; itens: ItemDeFeed[] } | { ok: false; erro: string };

const TAMANHO_DO_RESUMO = 280;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
  // Um item só vira objeto, não lista — sem isto o feed com uma notícia quebra.
  isArray: (nome) => ["item", "entry", "link", "category"].includes(nome),
});

type No = Record<string, unknown>;

/** Texto de um nó que pode vir como string, número ou `{ "#text": ... }`. */
function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return texto(v[0]);
  if (typeof v === "object") return texto((v as No)["#text"]);
  return "";
}

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", eacute: "é", ecirc: "ê",
  iacute: "í", oacute: "ó", ocirc: "ô", otilde: "õ", uacute: "ú", ccedil: "ç",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Eacute: "É", Ecirc: "Ê",
  Iacute: "Í", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Uacute: "Ú", Ccedil: "Ç",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

/** Entidades que sobram dentro de CDATA (o parser não as toca ali). */
export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

/** HTML → texto: tira tags, scripts, estilos e legendas de foto; uma linha só. */
export function htmlParaTexto(html: string): string {
  return decodificarEntidades(
    html
      .replace(/<(script|style|figcaption)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function cortar(s: string, max: number): string {
  if (s.length <= max) return s;
  const corte = s.slice(0, max);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > max * 0.6 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/** Link da matéria sem rastreio (`utm_*`, `fbclid`…) e sem âncora. Só http(s). */
export function limparUrl(bruta: string): string | null {
  try {
    const u = new URL(bruta.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_|^fbclid$|^gclid$|^mc_/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function soHttps(url: string | undefined | null): string | null {
  if (!url) return null;
  const limpo = decodificarEntidades(url.trim());
  return /^https:\/\/[^\s"'<>]+$/i.test(limpo) ? limpo : null;
}

function primeiraImagem(html: string): string | null {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return soHttps(m?.[1]);
}

function imagemDoItem(item: No, htmls: string[]): string | null {
  const attr = (v: unknown, nome: string) =>
    v && typeof v === "object" ? texto((v as No)[`@_${nome}`]) : "";
  const media = item["media:content"] ?? item["media:thumbnail"];
  const enclosure = item.enclosure as No | undefined;
  const candidatos = [
    texto(item["imagem-destaque"]),
    attr(Array.isArray(media) ? media[0] : media, "url"),
    enclosure && /^image\//i.test(attr(enclosure, "type")) ? attr(enclosure, "url") : "",
  ];
  for (const c of candidatos) {
    const ok = soHttps(c);
    if (ok) return ok;
  }
  for (const h of htmls) {
    const ok = primeiraImagem(h);
    if (ok) return ok;
  }
  return null;
}

function data(v: string): Date | null {
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function linkDoAtom(entry: No): string {
  const links = (entry.link as No[] | undefined) ?? [];
  const alternativo =
    links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  return alternativo ? texto(alternativo["@_href"]) || texto(alternativo) : "";
}

/** O Google Notícias põe " - Veículo" no fim do título. */
function semSufixoDaFonte(titulo: string, fonte: string | null): string {
  if (!fonte) return titulo;
  const sufixo = ` - ${fonte}`;
  return titulo.endsWith(sufixo) ? titulo.slice(0, -sufixo.length).trim() : titulo;
}

export function lerFeed(xml: string): ResultadoDoFeed {
  let doc: No;
  try {
    doc = parser.parse(xml) as No;
  } catch (e) {
    return { ok: false, erro: `XML ilegível: ${e instanceof Error ? e.message : String(e)}` };
  }

  const rss = doc.rss as No | undefined;
  const atom = doc.feed as No | undefined;
  // Página de erro em HTML com status 200 é FALHA, não "feed sem notícia".
  if (!rss && !atom) return { ok: false, erro: "a resposta não é um feed RSS/Atom" };

  const brutos: No[] = rss
    ? ((((rss.channel as No | undefined)?.item as No[] | undefined) ?? []) as No[])
    : (((atom!.entry as No[] | undefined) ?? []) as No[]);

  const itens: ItemDeFeed[] = [];
  for (const item of brutos) {
    const fonte = texto(item.source).trim() || null;
    const titulo = semSufixoDaFonte(htmlParaTexto(texto(item.title)), fonte);
    const url = limparUrl(rss ? texto(item.link) : linkDoAtom(item));
    const quando = data(
      texto(item.pubDate) || texto(item["dc:date"]) || texto(item.published) || texto(item.updated),
    );
    if (!titulo || !url || !quando) continue;

    const htmls = [
      texto(item["content:encoded"]),
      texto(item.description),
      texto(item.content),
      texto(item.summary),
    ].filter(Boolean);
    const resumoBruto = htmlParaTexto(
      texto(item["atom:subtitle"]) || texto(item.description) || texto(item.summary),
    )
      // Rodapé automático do WordPress: "O post X apareceu primeiro em Y."
      .replace(/\s*O post .+ apareceu primeiro em .+$/i, "")
      .trim();
    // O Google Notícias repete o título no resumo; resumo igual ao título é ruído.
    const resumo =
      resumoBruto && !resumoBruto.startsWith(titulo.slice(0, 40)) ? cortar(resumoBruto, TAMANHO_DO_RESUMO) : "";

    itens.push({
      titulo: cortar(titulo, 300),
      url,
      resumo,
      publicadaEm: quando,
      imagemUrl: imagemDoItem(item, htmls),
      fonte,
    });
  }
  return { ok: true, itens };
}
