import { describe, it, expect } from "vitest";
import { computeCrateSaldo, assertCrateMovement } from "@/lib/services/caixas.service";
import type { CrateSaldo, SaldoRow } from "@/lib/services/caixas.service";
import type { CaixaMovimentoInput } from "@/lib/validations/caixa";

const ZERO: SaldoRow = {
  entrada_limpa: 0,
  entrada_suja: 0,
  entrada_quebrada: 0,
  saida: 0,
  retorno: 0,
  saida_hig: 0,
  retorno_hig: 0,
  quebra_cliente: 0,
  quebra_higienizador: 0,
  quebra_limpa: 0,
  quebra_suja: 0,
};

const row = (patch: Partial<SaldoRow>): SaldoRow => ({ ...ZERO, ...patch });

const hoje = "2026-08-11";
const mov = (patch: Partial<CaixaMovimentoInput>): CaixaMovimentoInput =>
  ({ type: "SAIDA", quantity: 1, movementDate: hoje, ...patch }) as CaixaMovimentoInput;

const saldo = (patch: Partial<CrateSaldo>): CrateSaldo => ({
  limpas: 0,
  sujas: 0,
  emHigienizacao: 0,
  comClientes: 0,
  perdidas: 0,
  vazias: 0,
  ...patch,
});

describe("computeCrateSaldo — potes do estoque de caixas", () => {
  it("entrada limpa alimenta as limpas", () => {
    const s = computeCrateSaldo(row({ entrada_limpa: 100, entrada_quebrada: 5 }));
    expect(s).toEqual({
      limpas: 100,
      sujas: 0,
      emHigienizacao: 0,
      comClientes: 0,
      perdidas: 5,
      vazias: 100,
    });
  });

  it("saída tira das limpas e coloca com o cliente", () => {
    const s = computeCrateSaldo(row({ entrada_limpa: 100, saida: 30 }));
    expect(s.limpas).toBe(70);
    expect(s.comClientes).toBe(30);
  });

  it("retorno de cliente entra nas sujas, não nas limpas", () => {
    const s = computeCrateSaldo(row({ entrada_limpa: 100, saida: 30, retorno: 10 }));
    expect(s.limpas).toBe(70);
    expect(s.sujas).toBe(10);
    expect(s.comClientes).toBe(20);
  });

  it("ciclo de higienização: sujas → higienizador → limpas", () => {
    const base = { entrada_limpa: 100, saida: 30, retorno: 10 };
    const enviado = computeCrateSaldo(row({ ...base, saida_hig: 10 }));
    expect(enviado.sujas).toBe(0);
    expect(enviado.emHigienizacao).toBe(10);
    expect(enviado.vazias).toBe(70); // as 10 no higienizador não contam no estoque

    const voltou = computeCrateSaldo(row({ ...base, saida_hig: 10, retorno_hig: 10 }));
    expect(voltou.emHigienizacao).toBe(0);
    expect(voltou.limpas).toBe(80);
    expect(voltou.sujas).toBe(0);
  });

  it("quebra é debitada do pote de origem", () => {
    const s = computeCrateSaldo(
      row({
        entrada_limpa: 100,
        entrada_suja: 20,
        saida: 30,
        saida_hig: 5,
        quebra_limpa: 2,
        quebra_suja: 3,
        quebra_cliente: 4,
        quebra_higienizador: 1,
      }),
    );
    expect(s.limpas).toBe(68); // 100 - 30 - 2
    expect(s.sujas).toBe(12); // 20 - 5 - 3
    expect(s.emHigienizacao).toBe(4); // 5 - 0 - 1
    expect(s.comClientes).toBe(26); // 30 - 0 - 4
    expect(s.perdidas).toBe(10); // 2 + 3 + 4 + 1
  });

  /**
   * Compatibilidade: registros antigos não têm dirty/cleanerName nem os tipos novos.
   * Nesse cenário `limpas + sujas` precisa reproduzir a fórmula antiga de `vazias`:
   *   ENTRADA − SAIDA + RETORNO − QUEBRA(sem cliente)
   */
  it("reproduz o 'vazias' antigo para dados legados", () => {
    const legado = row({
      entrada_limpa: 250,
      entrada_quebrada: 7,
      saida: 90,
      retorno: 40,
      quebra_limpa: 6, // toda quebra antiga sem cliente cai aqui (dirty = false)
      quebra_cliente: 5,
    });
    const s = computeCrateSaldo(legado);
    const vaziasAntigo = 250 - 90 + 40 - 6;
    expect(s.vazias).toBe(vaziasAntigo);
    expect(s.limpas + s.sujas).toBe(vaziasAntigo);
    expect(s.comClientes).toBe(90 - 40 - 5);
    expect(s.perdidas).toBe(6 + 5 + 7);
  });
});

describe("assertCrateMovement — consistência do ledger", () => {
  it("entrada sempre pode", () => {
    expect(() => assertCrateMovement(saldo({}), mov({ type: "ENTRADA" }))).not.toThrow();
  });

  it("saída exige caixas limpas e cita as sujas quando existem", () => {
    expect(() =>
      assertCrateMovement(saldo({ limpas: 5, sujas: 20 }), mov({ type: "SAIDA", quantity: 10 })),
    ).toThrow(/higieniza/i);
    expect(() =>
      assertCrateMovement(saldo({ limpas: 10 }), mov({ type: "SAIDA", quantity: 10 })),
    ).not.toThrow();
  });

  it("envio para higienização exige caixas sujas", () => {
    expect(() =>
      assertCrateMovement(
        saldo({ limpas: 100, sujas: 3 }),
        mov({ type: "SAIDA_HIGIENIZACAO", quantity: 5, cleanerName: "Lava Tudo" }),
      ),
    ).toThrow(/suja/i);
  });

  it("retorno da higienização não pode exceder o que está lá", () => {
    expect(() =>
      assertCrateMovement(
        saldo({ emHigienizacao: 2 }),
        mov({ type: "RETORNO_HIGIENIZACAO", quantity: 5, cleanerName: "Lava Tudo" }),
      ),
    ).toThrow(/higienizador/i);
  });

  it("quebra é limitada pelo pote de origem", () => {
    expect(() =>
      assertCrateMovement(
        saldo({ comClientes: 1 }),
        mov({ type: "QUEBRA", quantity: 5, customerName: "Cliente" }),
      ),
    ).toThrow(/clientes/i);
    expect(() =>
      assertCrateMovement(
        saldo({ emHigienizacao: 1 }),
        mov({ type: "QUEBRA", quantity: 5, cleanerName: "Lava Tudo" }),
      ),
    ).toThrow(/higienizador/i);
    expect(() =>
      assertCrateMovement(saldo({ sujas: 1 }), mov({ type: "QUEBRA", quantity: 5, dirty: true })),
    ).toThrow(/suja/i);
    expect(() =>
      assertCrateMovement(saldo({ limpas: 1 }), mov({ type: "QUEBRA", quantity: 5 })),
    ).toThrow(/limpa/i);
  });
});
