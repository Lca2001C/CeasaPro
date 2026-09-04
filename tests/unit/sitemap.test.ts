import { describe, expect, it, afterEach } from "vitest";
import {
  PAGINAS_INDEXAVEIS,
  ROBOTS_DISALLOW,
  robotsConfig,
  sitemapEntries,
} from "@/lib/seo/paginas-publicas";

const KEYS = ["APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("sitemap — só páginas públicas", () => {
  it("lista landing, cadastro, login e documentos legais, e nada da área logada", () => {
    process.env.APP_URL = "https://app.ceasapro.com.br";
    const urls = sitemapEntries(new Date("2026-09-04T12:00:00Z")).map((e) => e.url);

    expect(urls).toEqual([
      "https://app.ceasapro.com.br/",
      "https://app.ceasapro.com.br/cadastro",
      "https://app.ceasapro.com.br/login",
      "https://app.ceasapro.com.br/termos",
      "https://app.ceasapro.com.br/privacidade",
    ]);
    expect(urls.some((u) => u.includes("/dashboard"))).toBe(false);
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);
    expect(PAGINAS_INDEXAVEIS[0]?.priority).toBe(1);
  });

  it("robots aponta o sitemap da mesma origem e bloqueia a área logada", () => {
    process.env.APP_URL = "https://app.ceasapro.com.br";
    const robots = robotsConfig();

    expect(robots.sitemap).toBe("https://app.ceasapro.com.br/sitemap.xml");
    expect(robots.host).toBe("app.ceasapro.com.br");
    const regras = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
    expect(regras?.disallow).toEqual([...ROBOTS_DISALLOW]);
    expect(regras?.disallow).toContain("/dashboard");
    expect(regras?.disallow).toContain("/admin");
    expect(regras?.disallow).toContain("/cadastro/confirmar");
  });
});
