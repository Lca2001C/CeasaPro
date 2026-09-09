import type { MetadataRoute } from "next";
import { absoluteUrl, appBaseUrl } from "@/lib/app-url";
import { isoDateTz } from "@/lib/tz";

/**
 * Páginas que o Google pode indexar.
 *
 * Só o que é público de verdade: landing, cadastro, login e documentos legais.
 * O restante do app exige sessão — listar no sitemap mandaria o crawler para
 * /login?next=… e poluiria a busca com telas de sistema.
 */
export const PAGINAS_INDEXAVEIS = [
  { path: "/", changeFrequency: "weekly" as const, priority: 1 },
  { path: "/cadastro", changeFrequency: "monthly" as const, priority: 0.9 },
  { path: "/login", changeFrequency: "monthly" as const, priority: 0.5 },
  { path: "/termos", changeFrequency: "yearly" as const, priority: 0.3 },
  { path: "/privacidade", changeFrequency: "yearly" as const, priority: 0.3 },
] as const;

/**
 * Caminhos que o crawler não deve gastar cota: área logada, APIs, tokens e
 * telas de aparelho (offline). Mais específico vence no robots.txt do Google.
 */
export const ROBOTS_DISALLOW = [
  "/admin",
  "/api/",
  "/dashboard",
  "/produtos",
  "/vendas",
  "/fornecedores",
  "/compras",
  "/fiado",
  "/estoque",
  "/despesas",
  "/cotacoes",
  "/caixas-plasticas",
  "/higienizacao",
  "/embalagens",
  "/relatorios",
  "/plano",
  "/configuracoes",
  "/ajuda",
  "/conta",
  "/assinatura",
  "/onboarding",
  "/alterar-senha",
  "/offline",
  "/consulta-offline",
  "/cadastro/confirmar",
  "/recuperar-senha/",
] as const;

export function sitemapEntries(now: Date = new Date()): MetadataRoute.Sitemap {
  const lastModified = isoDateTz(now);
  return PAGINAS_INDEXAVEIS.map((pagina) => ({
    url: absoluteUrl(pagina.path),
    lastModified,
    changeFrequency: pagina.changeFrequency,
    priority: pagina.priority,
  }));
}

/**
 * XML que o Google Search Console precisa GET em /sitemap.xml.
 *
 * Gerado na mão (não pelo `app/sitemap.ts` do Next): a convenção de metadata
 * em produção respondia 500 para parte dos fetches — o Search Console marcava
 * "Não foi possível buscar o sitemap" / tipo Desconhecido. A rota devolve este
 * texto com `Content-Type: application/xml`.
 */
export function sitemapXml(now: Date = new Date()): string {
  const lastmod = isoDateTz(now);
  const urls = PAGINAS_INDEXAVEIS.map((pagina) => {
    const loc = absoluteUrl(pagina.path);
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${pagina.changeFrequency}</changefreq>\n    <priority>${pagina.priority}</priority>\n  </url>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robotsConfig(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...ROBOTS_DISALLOW],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: new URL(appBaseUrl()).host,
  };
}
