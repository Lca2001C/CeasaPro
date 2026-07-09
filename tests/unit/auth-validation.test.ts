import { describe, expect, it } from "vitest";
import { forgotSchema, resetSchema } from "@/lib/validations/auth";

describe("auth validation", () => {
  it("normalizes email before using it in auth flows", () => {
    const parsed = forgotSchema.parse({ email: "  DONO@CEASAPRO.COM.BR " });

    expect(parsed.email).toBe("dono@ceasapro.com.br");
  });

  it("requires stronger reset passwords", () => {
    expect(resetSchema.safeParse({ token: "token-valido", password: "abc123" }).success).toBe(
      false,
    );
    expect(resetSchema.safeParse({ token: "token-valido", password: "ceasa123" }).success).toBe(
      true,
    );
  });
});
