import { describe, it, expect } from "vitest";
import { resolvePeriod } from "@/lib/dates";
import { presetDoRelatorio } from "@/lib/reports/report.types";
import { trechoDeNomeDeArquivo } from "@/lib/reports/arquivo-exportado";
import { isoDateTz } from "@/lib/tz";

/**
 * "Todo o período" existe para o extrato de um cliente — e só para ele: no
 * fluxo de caixa ou no lucro por produto, o histórico inteiro seria consulta
 * pesada que a tela não oferece.
 */
describe("Todo o período", () => {
  it("vai de 01/01/2000 até hoje, no fuso do app", () => {
    const agora = new Date("2026-10-23T15:00:00.000Z");
    const p = resolvePeriod({ preset: "tudo", now: agora });
    expect(isoDateTz(p.from)).toBe("2000-01-01");
    expect(isoDateTz(p.to)).toBe("2026-10-23");
  });

  it("só vale no relatório de vendas com cliente", () => {
    expect(presetDoRelatorio("VENDAS", "tudo", "João")).toBe("tudo");
    expect(presetDoRelatorio("VENDAS", "tudo", undefined)).toBe("mes");
    expect(presetDoRelatorio("FLUXO_CAIXA", "tudo", "João")).toBe("mes");
    expect(presetDoRelatorio("VENDAS", "semana", undefined)).toBe("semana");
  });
});

describe("nome do arquivo com o cliente", () => {
  it("sem acento, aspas nem espaço — o nome vai no Content-Disposition", () => {
    expect(trechoDeNomeDeArquivo('João "Zé" da Silva')).toBe("joao-ze-da-silva");
    expect(trechoDeNomeDeArquivo("   ")).toBe("cliente");
  });
});
