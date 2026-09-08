import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { createTestTenant, cleanupTenants } from "../helpers/factory";

/**
 * As duas taxonomias não podem virar um mesmo número.
 *
 * O boletim da praça traz produto ESPECÍFICO com mínimo/comum/máximo; a série
 * nacional traz produto GENÉRICO com preço único. Medindo as duas fontes reais,
 * três produtos têm nome idêntico — e `UVA ITALIA` e `UVA NIAGARA` têm também a
 * MESMA unidade ("KG").
 *
 * Sem o discriminador de série, isso é o mesmo `CeasaProduct`, logo a mesma
 * chave de `CeasaQuote`, logo o `ON CONFLICT DO UPDATE` da gravação faz a última
 * importação do dia sobrescrever a outra EM SILÊNCIO — apagando o mínimo e o
 * máximo reais. Nada erraria de forma visível: a tela mostraria um número
 * plausível, do jeito errado.
 */

const uniq = () => Math.random().toString(36).slice(2, 10);
const CENTRAL = `SER${uniq().slice(0, 5)}`.toUpperCase();
const tenants: string[] = [];
const HOJE = new Date();
HOJE.setUTCHours(0, 0, 0, 0);

const DO_BOLETIM = [
  { produto: "UVA ITALIA", unidade: "KG", minimo: 8, comum: 10, maximo: 12, referencia: 10 },
];
const DA_SERIE_NACIONAL = [
  { produto: "UVA ITALIA", unidade: "KG", minimo: null, comum: null, maximo: null, referencia: 7 },
];

beforeAll(async () => {
  await prisma.ceasaCentral.create({
    data: {
      code: CENTRAL,
      name: "Central de Duas Fontes",
      city: "Contagem",
      uf: "MG",
      sourceKey: "ceasaminas",
      sourceParams: { mercado: "214" },
    },
  });
});

afterAll(async () => {
  await cleanupTenants(tenants);
  await prisma.ceasaQuote.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaImportRun.deleteMany({ where: { centralCode: CENTRAL } });
  await prisma.ceasaCentral.deleteMany({ where: { code: CENTRAL } });
  await prisma.ceasaProduct.deleteMany({ where: { slug: "uva-italia" } });
});

describe("séries não se sobrescrevem", () => {
  it("o mesmo nome e a mesma unidade em fontes diferentes são produtos DIFERENTES", async () => {
    await CotacoesImportService.gravar({
      centralCode: CENTRAL,
      quoteDate: HOJE,
      linhas: DO_BOLETIM,
      sourceKey: "ceasaminas",
    });
    await CotacoesImportService.gravar({
      centralCode: CENTRAL,
      quoteDate: HOJE,
      linhas: DA_SERIE_NACIONAL,
      sourceKey: "conab",
    });

    const produtos = await prisma.ceasaProduct.findMany({
      where: { slug: "uva-italia" },
      select: { serie: true },
      orderBy: { serie: "asc" },
    });
    expect(produtos.map((p) => p.serie)).toEqual(["CENTRAL", "NACIONAL"]);

    // Duas cotações, não uma sobrescrevendo a outra.
    const cotacoes = await prisma.ceasaQuote.findMany({
      where: { centralCode: CENTRAL },
      include: { product: { select: { serie: true } } },
    });
    expect(cotacoes).toHaveLength(2);

    // E o que mais importa: o mínimo/máximo do boletim SOBREVIVEU.
    const daPraca = cotacoes.find((c) => c.product.serie === "CENTRAL")!;
    expect(Number(daPraca.minPrice)).toBe(8);
    expect(Number(daPraca.maxPrice)).toBe(12);
    expect(Number(daPraca.refPrice)).toBe(10);

    const nacional = cotacoes.find((c) => c.product.serie === "NACIONAL")!;
    expect(Number(nacional.refPrice)).toBe(7);
  });

  it("a tela da central mostra SÓ a série dela, sem trocar de vocabulário", async () => {
    const t = await createTestTenant(`Empresa Series ${uniq()}`);
    tenants.push(t);
    await prisma.tenant.update({ where: { id: t }, data: { ceasaCentralCode: CENTRAL } });

    const painel = await CotacoesService.getPainel(t);
    // A central é `ceasaminas` → série CENTRAL. A linha da série nacional, ainda
    // que seja do MESMO dia e da MESMA central, não entra na lista.
    expect(painel.linhas).toHaveLength(1);
    expect(Number(painel.linhas[0]!.refPrice)).toBe(10);
    expect(Number(painel.linhas[0]!.minPrice)).toBe(8);
  });

  it("reimportar a MESMA série continua corrigindo, não duplicando", async () => {
    // A idempotência não pode ter sido quebrada pela separação.
    await CotacoesImportService.gravar({
      centralCode: CENTRAL,
      quoteDate: HOJE,
      linhas: [{ ...DO_BOLETIM[0]!, comum: 11, referencia: 11 }],
      sourceKey: "ceasaminas",
    });

    const daPraca = await prisma.ceasaQuote.findMany({
      where: { centralCode: CENTRAL, product: { serie: "CENTRAL" } },
    });
    expect(daPraca).toHaveLength(1);
    expect(Number(daPraca[0]!.refPrice)).toBe(11);
  });
});
