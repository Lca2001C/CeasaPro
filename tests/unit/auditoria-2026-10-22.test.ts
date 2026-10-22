import { describe, it, expect } from "vitest";
import { fiadoAtrasado, DIAS_PARA_COBRAR_SEM_VENCIMENTO } from "@/lib/fiado/atraso";
import { produtoSchema } from "@/lib/validations/produto";
import { baixaEmbalagemSchema } from "@/lib/validations/embalagem";
import { linhasDeHigienizacao } from "@/lib/despesas/contas-unificadas";
import { addDaysTz, startOfDayTz } from "@/lib/tz";

const AGORA = new Date("2026-10-22T15:00:00.000Z");

describe("fiadoAtrasado: uma régua para relatório, sino, push e /fiado", () => {
  it("com vencimento: atrasado a partir do dia seguinte", () => {
    const hoje = startOfDayTz(AGORA);
    expect(fiadoAtrasado({ dueDate: hoje, createdAt: hoje }, AGORA)).toBe(false);
    expect(fiadoAtrasado({ dueDate: addDaysTz(hoje, -1), createdAt: hoje }, AGORA)).toBe(true);
  });

  it(`sem vencimento: atrasado depois de ${DIAS_PARA_COBRAR_SEM_VENCIMENTO} dias aberto`, () => {
    const hoje = startOfDayTz(AGORA);
    expect(fiadoAtrasado({ dueDate: null, createdAt: addDaysTz(hoje, -10) }, AGORA)).toBe(false);
    expect(fiadoAtrasado({ dueDate: null, createdAt: addDaysTz(hoje, -45) }, AGORA)).toBe(true);
  });
});

describe("estoque inicial do produto com os limites de quantidade.ts", () => {
  const base = { name: "Tomate", saleUnit: "CAIXA" as const, active: true };

  it("recusa mais de 3 casas e acima do teto", () => {
    expect(produtoSchema.safeParse({ ...base, estoqueInicial: 0.0004, custoInicial: 1 }).success).toBe(false);
    expect(produtoSchema.safeParse({ ...base, estoqueInicial: 2_000_000, custoInicial: 1 }).success).toBe(false);
  });

  it("recusa custo com mais de 4 casas", () => {
    expect(produtoSchema.safeParse({ ...base, estoqueInicial: 1, custoInicial: 1.23456 }).success).toBe(false);
  });

  it("aceita o caso normal", () => {
    expect(produtoSchema.safeParse({ ...base, estoqueInicial: 12.5, custoInicial: 3.3333 }).success).toBe(true);
  });
});

describe("baixa de embalagem aceita chave de idempotência", () => {
  it("o schema não descarta a chave", () => {
    const r = baixaEmbalagemSchema.parse({
      packagingTypeId: "t",
      quantity: 2,
      motivo: "molhou",
      idempotencyKey: "4b3a2f6e-8f4a-4d62-9a3e-0b8c7c2d1e10",
    });
    expect(r.idempotencyKey).toBeDefined();
  });
});

describe("higienização paga em partes, filtrada pela data de pagamento", () => {
  const lote = {
    id: "l1",
    cleanerName: "Lava Já",
    totalAmount: 300,
    paidAmount: 300,
    sentDate: new Date("2026-09-01T03:00:00.000Z"),
    paidDate: new Date("2026-10-05T03:00:00.000Z"),
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    pagamentos: [
      { amount: 100, paidAt: new Date("2026-09-25T03:00:00.000Z") },
      { amount: 200, paidAt: new Date("2026-10-05T03:00:00.000Z") },
    ],
  };
  const filtro = (from: string, to: string) => ({
    status: "PAGO" as const,
    dateField: "paidDate" as const,
    from,
    to,
  });

  it("setembro mostra os R$ 100 pagos em setembro", () => {
    const [linha] = linhasDeHigienizacao(lote, filtro("2026-09-01", "2026-09-30"), AGORA);
    expect(linha?.amount).toBe("100.00");
    expect(linha?.paidDate).toBe("2026-09-25T03:00:00.000Z");
  });

  it("outubro mostra só os R$ 200 de outubro", () => {
    const linhas = linhasDeHigienizacao(lote, filtro("2026-10-01", "2026-10-31"), AGORA);
    expect(linhas.map((l) => l.amount)).toEqual(["200.00"]);
  });

  it("mês sem pagamento não mostra o lote", () => {
    expect(linhasDeHigienizacao(lote, filtro("2026-08-01", "2026-08-31"), AGORA)).toEqual([]);
  });
});
