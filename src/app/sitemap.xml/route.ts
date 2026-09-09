import { sitemapXml } from "@/lib/seo/paginas-publicas";

/**
 * GET /sitemap.xml — o que o Google Search Console busca.
 *
 * Rota explícita, não `app/sitemap.ts`: a convenção de metadata do Next, com
 * `force-dynamic`, chegou a devolver 500 para o crawler (tipo "Desconhecido" no
 * Console). Daqui sai XML cru, sem layout, sem CSP, com cache curto na borda.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return new Response(sitemapXml(), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
