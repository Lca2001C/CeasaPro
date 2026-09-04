import type { MetadataRoute } from "next";
import { absoluteUrl, appBaseUrl } from "@/lib/app-url";

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
  return PAGINAS_INDEXAVEIS.map((pagina) => ({
    url: absoluteUrl(pagina.path),
    lastModified: now,
    changeFrequency: pagina.changeFrequency,
    priority: pagina.priority,
  }));
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
