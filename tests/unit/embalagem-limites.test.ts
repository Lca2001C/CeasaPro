import { describe, it, expect } from "vitest";
import {
  QTD_MAX,
  ativarEstoqueEmbalagemSchema,
  entradaEmbalagemSchema,
  vendaEmbalagemSchema,
} from "@/lib/validations/embalagem";

/**
 * Sem teto, um valor colado por engano (1.500.000.000) cabia na coluna mas, somado
 * a outro, estourava o saldo e derrubava /embalagens.
 */
describe("Teto de quantidade de embalagem", () => {
  const base = { packagingTypeId: "t1" };

  it("recusa acima do teto nos três lançamentos", () => {
    expect(
      vendaEmbalagemSchema.safeParse({
        ...base,
        saleDate: "2026-09-30",
        quantity: QTD_MAX + 1,
        unitPrice: 1,
      }).success,
    ).toBe(false);
    expect(entradaEmbalagemSchema.safeParse({ ...base, quantity: 1_500_000_000 }).success).toBe(
      false,
    );
    expect(
      ativarEstoqueEmbalagemSchema.safeParse({ ...base, quantidadeAtual: QTD_MAX + 1 }).success,
    ).toBe(false);
  });

  it("aceita o teto", () => {
    expect(
      entradaEmbalagemSchema.safeParse({ ...base, quantity: QTD_MAX, unitCost: 1 }).success,
    ).toBe(true);
  });
});

describe("Custo da embalagem", () => {
  const base = { packagingTypeId: "t1" };

  it("entrada exige o custo de cada uma — sem ele o lucro sairia inflado", () => {
    expect(entradaEmbalagemSchema.safeParse({ ...base, quantity: 10 }).success).toBe(false);
    expect(entradaEmbalagemSchema.safeParse({ ...base, quantity: 10, unitCost: 0 }).success).toBe(
      false,
    );
    expect(
      entradaEmbalagemSchema.safeParse({ ...base, quantity: 10, unitCost: 3.3333 }).success,
    ).toBe(true);
  });

  it("saldo inicial exige custo; ligar com zero não", () => {
    expect(
      ativarEstoqueEmbalagemSchema.safeParse({ ...base, quantidadeAtual: 5 }).success,
    ).toBe(false);
    expect(
      ativarEstoqueEmbalagemSchema.safeParse({ ...base, quantidadeAtual: 5, custoUnitario: 1.2 })
        .success,
    ).toBe(true);
    expect(
      ativarEstoqueEmbalagemSchema.safeParse({ ...base, quantidadeAtual: 0 }).success,
    ).toBe(true);
  });
});
