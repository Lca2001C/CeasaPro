import { describe, expect, it } from "vitest";
import {
  fatiaListaComPrefixo,
  linhaDeDespesa,
  linhasDeHigienizacao,
} from "@/lib/despesas/contas-unificadas";

const AGORA = new Date("2026-09-08T15:00:00.000Z");

describe("fatiaListaComPrefixo", () => {
  it("na primeira página mistura o prefixo com o começo do resto", () => {
    expect(fatiaListaComPrefixo(3, 0, 100)).toEqual({
      prefixSkip: 0,
      prefixTake: 3,
      restoSkip: 0,
      restoTake: 97,
    });
  });

  it("nas páginas seguintes só fatia o resto, descontando o prefixo", () => {
    expect(fatiaListaComPrefixo(3, 100, 100)).toEqual({
      prefixSkip: 0,
      prefixTake: 0,
      restoSkip: 97,
      restoTake: 100,
    });
  });

  it("skip no meio do prefixo", () => {
    expect(fatiaListaComPrefixo(5, 2, 10)).toEqual({
      prefixSkip: 2,
      prefixTake: 5 - 2,
      restoSkip: 0,
      restoTake: 7,
    });
  });
});

describe("linhasDeHigienizacao", () => {
  const lote = {
    id: "hig-1",
    cleanerName: "Lava Tudo",
    totalAmount: 50,
    paidAmount: 0,
    sentDate: new Date("2026-09-01T03:00:00.000Z"),
    paidDate: null,
    createdAt: new Date("2026-09-01T03:00:00.000Z"),
  };

  it("entra nas pendentes com o saldo e some se o plano filtrar categoria", () => {
    const pendentes = linhasDeHigienizacao(lote, { status: "PENDENTE" }, AGORA);
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]!.origem).toBe("higienizacao");
    expect(pendentes[0]!.amount).toBe("50.00");
    expect(pendentes[0]!.vencida).toBe(true);

    expect(linhasDeHigienizacao(lote, { status: "PENDENTE", type: "FIXA" }, AGORA)).toEqual([]);
    expect(
      linhasDeHigienizacao(lote, { status: "PENDENTE", categoryId: "cat-1" }, AGORA),
    ).toEqual([]);
  });

  it("módulo desligado é responsabilidade do serviço; aqui um lote pago vira linha na aba Pagas", () => {
    const pago = {
      ...lote,
      paidAmount: 50,
      paidDate: new Date("2026-09-05T15:00:00.000Z"),
    };
    const pagas = linhasDeHigienizacao(pago, { status: "PAGO" }, AGORA);
    expect(pagas).toHaveLength(1);
    expect(pagas[0]!.status).toBe("PAGO");
    expect(pagas[0]!.amount).toBe("50.00");
    expect(linhasDeHigienizacao(pago, { status: "PENDENTE" }, AGORA)).toEqual([]);
  });
});

describe("linhaDeDespesa", () => {
  it("marca vencida só quando pendente e o vencimento já passou", () => {
    const base = {
      id: "d1",
      description: "Aluguel do box",
      amount: 1200,
      type: "FIXA" as const,
      status: "PENDENTE" as const,
      paymentMethod: null,
      recurring: false,
      categoryName: "Aluguel",
      dueDate: new Date("2026-09-01T03:00:00.000Z"),
      paidDate: null,
    };
    expect(linhaDeDespesa(base, AGORA).vencida).toBe(true);
    expect(linhaDeDespesa({ ...base, status: "PAGO", paidDate: AGORA }, AGORA).vencida).toBe(
      false,
    );
  });
});
