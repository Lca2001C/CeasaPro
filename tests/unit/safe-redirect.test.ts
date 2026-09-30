import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  it("allows local paths with query and hash", () => {
    expect(safeRedirectPath("/dashboard?tab=hoje#topo", "/fallback")).toBe(
      "/dashboard?tab=hoje#topo",
    );
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(safeRedirectPath("https://evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example", "/dashboard")).toBe("/dashboard");
  });

  it("rejects script-like and login-loop redirects", () => {
    expect(safeRedirectPath("javascript:alert(1)", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/login?next=/admin", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/./login", "/dashboard")).toBe("/dashboard");
  });

  // O parser normaliza ponto-segmento: estes passavam na checagem da string
  // crua e saíam como "//evil.com" (open redirect no login e em /api/auth/renovar).
  it.each([
    "/.//evil.com",
    "/..//evil.com",
    "/%2e//evil.com",
    "/%2E//evil.com",
    "/a/..//evil.com",
    "/./../..//evil.com",
    "/.//evil.com/caminho?x=1",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "https:evil.com",
    "http://evil.com",
    "HTTPS://evil.com",
    "data:text/html,oi",
    "evil.com",
  ])("recusa %j", (entrada) => {
    expect(safeRedirectPath(entrada, "/dashboard")).toBe("/dashboard");
  });

  it("mantém caminhos percent-encoded que continuam locais", () => {
    // O navegador não decodifica %2F no caminho: isto é o caminho "/%2F/x" do próprio site.
    expect(safeRedirectPath("/%2F/evil.com", "/dashboard")).toBe("/%2F/evil.com");
    expect(safeRedirectPath("/a/../vendas", "/dashboard")).toBe("/vendas");
  });

  it("é idempotente", () => {
    const entradas = [
      "/dashboard?tab=hoje#topo",
      "/.//evil.com",
      "/%2e//evil.com",
      "/a/../vendas",
      "/%2F/evil.com",
      "//evil.com",
    ];
    for (const e of entradas) {
      const uma = safeRedirectPath(e, "/dashboard");
      expect(safeRedirectPath(uma, "/dashboard")).toBe(uma);
      expect(uma.startsWith("//")).toBe(false);
    }
  });
});
