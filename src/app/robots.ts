import type { MetadataRoute } from "next";
import { robotsConfig } from "@/lib/seo/paginas-publicas";

/** /robots.txt — aponta o crawler para o sitemap e fora da área logada. */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsConfig();
}
