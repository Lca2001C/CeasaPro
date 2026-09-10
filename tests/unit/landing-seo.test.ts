import { describe, expect, it } from "vitest";
import {
  CANONICAL_URL,
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  landingMetadata,
  softwareApplicationLd,
} from "@/lib/seo/landing";

describe("SEO da landing", () => {
  it("o title cabe no SERP e nomeia o setor", () => {
    expect(LANDING_TITLE.length).toBeLessThanOrEqual(60);
    expect(LANDING_TITLE).toMatch(/CeasaPro/i);
    expect(LANDING_TITLE).toMatch(/Hortifrúti/i);
  });

  it("a description fica no teto de 155 caracteres e cita as dores do box", () => {
    expect(LANDING_DESCRIPTION.length).toBeLessThanOrEqual(155);
    expect(LANDING_DESCRIPTION).toMatch(/estoque/i);
    expect(LANDING_DESCRIPTION).toMatch(/caixaria/i);
    expect(LANDING_DESCRIPTION).toMatch(/vendas/i);
  });

  it("o canonical aponta só para o www de produção", () => {
    const meta = landingMetadata();
    expect(meta.alternates?.canonical).toBe("https://www.ceasapro.com.br/");
    expect(CANONICAL_URL).toBe("https://www.ceasapro.com.br/");
    expect(meta.openGraph?.url).toBe(CANONICAL_URL);
    // `Metadata["twitter"]` é uma UNIÃO no Next, e `card` só existe em parte dos
    // membros — ler direto não compila (`Property 'card' does not exist on type
    // 'Twitter'`). O estreitamento é só para o TypeScript; a asserção é a mesma.
    expect((meta.twitter as { card?: string } | undefined)?.card).toBe("summary_large_image");
  });

  it("o JSON-LD é SoftwareApplication de negócio, sem inventar módulo", () => {
    const ld = softwareApplicationLd();
    expect(ld["@type"]).toBe("SoftwareApplication");
    expect(ld.applicationCategory).toBe("BusinessApplication");
    expect(ld.operatingSystem).toBe("Web");
    expect(ld.name).toBe("CeasaPro");
    expect(ld.featureList.join(" ")).toMatch(/caixaria/i);
    expect(ld.featureList.join(" ")).not.toMatch(/romaneio de carga/i);
  });
});
