import { describe, it, expect } from "vitest";
import {
  whereDeFiltro,
  proximoVencimento,
  mesAnterior,
  refMes,
} from "@/lib/services/despesas.service";
import { despesaSchema, despesaUpdateSchema } from "@/lib/validations/despesa";

/**
 * O `where` da listagem é o ponto onde três consumidores TÊM de concordar: a
 * lista, a contagem da paginação e os links dos avisos. Quando divergem, o
 * usuário vê "página 2 de 3" sem página 2 — ou clica em "vencidas" e recebe a
 * lista inteira.
 */
describe("whereDeFiltro", () => {
  const agora = new Date("2026-09-03T12:00:00.000Z");

  it("sem filtro, não restringe nada", () => {
    expect(whereDeFiltro({}, agora)).toEqual({});
  });

  it("status simples vira igualdade", () => {
    expect(whereDeFiltro({ status: "PAGO" }, agora)).toMatchObject({ status: "PAGO" });
  });

  it("vencidas = PENDENTE com vencimento antes de HOJE", () => {
    const w = whereDeFiltro({ vencidas: true }, agora);
    expect(w.status).toBe("PENDENTE");
    // O corte é o início do dia no fuso do app, não "agora": conta que vence
    // hoje não está vencida às 9h da manhã.
    const cond = (w.AND as { dueDate: { lt: Date } }[])[0]!;
    expect(cond.dueDate.lt.toISOString()).toBe("2026-09-03T03:00:00.000Z");
  });

  it("vencidas ignora o status pedido — pago com atraso não está vencido", () => {
    const w = whereDeFiltro({ vencidas: true, status: "PAGO" }, agora);
    expect(w.status).toBe("PENDENTE");
  });

  it("busca por descrição é case-insensitive", () => {
    expect(whereDeFiltro({ q: "luz" }, agora)).toMatchObject({
      description: { contains: "luz", mode: "insensitive" },
    });
  });

  it("tipo e categoria entram como igualdade", () => {
    const w = whereDeFiltro({ type: "FIXA", categoryId: "cat-1" }, agora);
    expect(w).toMatchObject({ type: "FIXA", categoryId: "cat-1" });
  });

  it("período usa o campo escolhido (vencimento é o padrão)", () => {
    const porVencimento = whereDeFiltro({ from: "2026-08-01", to: "2026-08-31" }, agora);
    expect(porVencimento.AND).toHaveLength(1);
    expect(Object.keys((porVencimento.AND as object[])[0]!)).toEqual(["dueDate"]);

    const porPagamento = whereDeFiltro(
      { dateField: "paidDate", from: "2026-08-01" },
      agora,
    );
    expect(Object.keys((porPagamento.AND as object[])[0]!)).toEqual(["paidDate"]);

    const porCadastro = whereDeFiltro({ dateField: "createdAt", from: "2026-08-01" }, agora);
    expect(Object.keys((porCadastro.AND as object[])[0]!)).toEqual(["createdAt"]);
  });

  it("período + vencidas coexistem em vez de um apagar o outro", () => {
    // Este era o bug latente: atribuir `where.dueDate` duas vezes fazia o
    // segundo filtro sobrescrever silenciosamente o corte de "vencidas".
    const w = whereDeFiltro({ vencidas: true, from: "2026-08-01" }, agora);
    expect(w.status).toBe("PENDENTE");
    expect(w.AND).toHaveLength(2);
  });

  it("as datas do filtro são interpretadas no fuso do app", () => {
    const w = whereDeFiltro({ from: "2026-08-01", to: "2026-08-31" }, agora);
    const range = (w.AND as { dueDate: { gte: Date; lte: Date } }[])[0]!.dueDate;
    // 00:00 de 01/08 no Brasil = 03:00 UTC; 23:59:59.999 de 31/08 = 02:59:59.999 de 01/09.
    expect(range.gte.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    expect(range.lte.toISOString()).toBe("2026-09-01T02:59:59.999Z");
  });
});

describe("proximoVencimento", () => {
  const proximo = (iso: string) => proximoVencimento(new Date(iso)).toISOString();

  it("mês cheio avança normalmente", () => {
    // 10/08 (00:00 BRT = 03:00Z) → 10/09
    expect(proximo("2026-08-10T03:00:00.000Z")).toBe("2026-09-10T03:00:00.000Z");
  });

  it("não vaza para o mês seguinte quando o dia não existe no destino", () => {
    // 31/01 → 28/02, não 03/03. Sem isto, o aluguel do dia 31 ia andando de mês
    // em mês e o cliente perdia a data de vencimento.
    expect(proximo("2026-01-31T03:00:00.000Z")).toBe("2026-02-28T03:00:00.000Z");
    expect(proximo("2026-08-31T03:00:00.000Z")).toBe("2026-09-30T03:00:00.000Z");
  });

  it("respeita ano bissexto", () => {
    expect(proximo("2028-01-31T03:00:00.000Z")).toBe("2028-02-29T03:00:00.000Z");
  });

  it("vira o ano corretamente", () => {
    expect(proximo("2026-12-05T03:00:00.000Z")).toBe("2027-01-05T03:00:00.000Z");
  });
});

describe("mês de referência", () => {
  it("refMes usa o fuso do app", () => {
    // 01/09 às 00:30 BRT = 03:30Z — e 31/08 às 23h BRT = 02:00Z de 01/09.
    expect(refMes(new Date("2026-09-01T03:30:00.000Z"))).toBe("2026-09");
    expect(refMes(new Date("2026-09-01T02:00:00.000Z"))).toBe("2026-08");
  });

  it("mesAnterior vira o ano", () => {
    expect(mesAnterior("2026-09")).toBe("2026-08");
    expect(mesAnterior("2026-01")).toBe("2025-12");
  });
});

describe("validação da despesa", () => {
  const base = {
    description: "Aluguel do box",
    amount: 1200,
    type: "FIXA" as const,
  };

  it("pendente não precisa de data de pagamento", () => {
    expect(despesaSchema.safeParse({ ...base, status: "PENDENTE" }).success).toBe(true);
  });

  it("paga SEM data de pagamento é recusada", () => {
    // Sem a data, a conta não entra no fluxo de caixa nem no relatório de
    // contas pagas: o dinheiro saiu e nenhum relatório sabe quando.
    const r = despesaSchema.safeParse({ ...base, status: "PAGO" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.path).toEqual(["paidDate"]);
    }
  });

  it("paga COM data de pagamento passa", () => {
    expect(
      despesaSchema.safeParse({ ...base, status: "PAGO", paidDate: "2026-09-03" }).success,
    ).toBe(true);
  });

  it("a mesma regra vale na edição", () => {
    const r = despesaUpdateSchema.safeParse({ ...base, id: "abc", status: "PAGO" });
    expect(r.success).toBe(false);
  });

  it("forma de pagamento é opcional e não aceita FIADO", () => {
    expect(
      despesaSchema.safeParse({ ...base, status: "PENDENTE", paymentMethod: "BOLETO" }).success,
    ).toBe(true);
    expect(
      despesaSchema.safeParse({ ...base, status: "PENDENTE", paymentMethod: null }).success,
    ).toBe(true);
    // Conta a pagar não é fiado — o enum de despesa é separado do de venda.
    expect(
      despesaSchema.safeParse({ ...base, status: "PENDENTE", paymentMethod: "FIADO" }).success,
    ).toBe(false);
  });
});
