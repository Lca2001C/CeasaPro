import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/seo/paginas-publicas";

/**
 * /sitemap.xml — o Google Search Console aponta para este endereço.
 *
 * `force-dynamic` porque a origem vem de APP_URL em runtime: um sitemap
 * gerado no build com localhost iria para produção e o Search Console
 * recusaria as URLs.
 */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
