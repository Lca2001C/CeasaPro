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
  });
});
