import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { sessaoConfere } from "@/lib/auth/revogacao";
import { semTokenNaUrl, limparEvento } from "@/lib/observabilidade/sentry";
import { assertMesmaOrigem } from "@/lib/http/mesma-origem";
import { vendaItemSchema } from "@/lib/validations/venda";
import { compraItemSchema } from "@/lib/validations/compra";
import { ajusteEstoqueSchema } from "@/lib/validations/estoque";
import { ITENS_MAX } from "@/lib/validations/quantidade";
import { proximoVencimento } from "@/lib/services/despesas.service";
import { computeCrateSaldo, assertCrateMovement } from "@/lib/services/caixas.service";
import type { SaldoRow } from "@/lib/services/caixas.service";
import { FinancialCalc } from "@/lib/services/financial-calc.service";
import { civilParts } from "@/lib/tz";
import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Correções da auditoria de 21/10 que têm regra pura (sem banco). As que
 * dependem de transação estão em tests/integration/auditoria-2026-10-21.test.ts.
 */

describe("logout deste aparelho derruba o access dele (fid)", () => {
  const linha = { ue: 3, ativo: true, excluido: null, te: 1 };
  it("linhagem encerrada: não vale, mesmo com os epochs em dia", () => {
    expect(sessaoConfere({ sev: 3, tev: 1 }, { ...linha, familiaEncerrada: true })).toBe(false);
  });
  it("linhagem viva: vale", () => {
    expect(sessaoConfere({ sev: 3, tev: 1 }, { ...linha, familiaEncerrada: false })).toBe(true);
  });
});

describe("Sentry não recebe token de URL nem a mensagem do Prisma", () => {
  it("troca o token do caminho por :token", () => {
    expect(semTokenNaUrl("https://app/recuperar-senha/abc123?x=1")).toBe(
      "https://app/recuperar-senha/:token?x=1",
    );
    expect(semTokenNaUrl("/cadastro/confirmar/tok-xyz")).toBe("/cadastro/confirmar/:token");
    expect(semTokenNaUrl("/vendas/nova")).toBe("/vendas/nova");
  });

  it("limpa request, transação, breadcrumbs e a mensagem do erro do Prisma", () => {
    const evento = {
      request: { url: "https://app/recuperar-senha/segredo" },
      transaction: "/recuperar-senha/segredo",
      breadcrumbs: [{ category: "navigation", data: { from: "/x", to: "/cadastro/confirmar/t1" } }],
      exception: {
        values: [{ type: "PrismaClientValidationError", value: "where: { email: 'a@b.c' }" }],
      },
    } as unknown as ErrorEvent;
    const limpo = limparEvento(evento);
    expect(limpo.request?.url).toBe("https://app/recuperar-senha/:token");
    expect(limpo.transaction).toBe("/recuperar-senha/:token");
    expect(limpo.breadcrumbs?.[0]?.data?.to).toBe("/cadastro/confirmar/:token");
    expect(limpo.exception?.values?.[0]?.value).toBe("PrismaClientValidationError");
  });
});

describe("escrita de outra origem é recusada (login/logout CSRF)", () => {
  const req = (h: Record<string, string>) =>
    new Request("https://app.ceasapro.com.br/api/auth/login", { method: "POST", headers: h });

  it("Origin de outro site: 403", () => {
    expect(() => assertMesmaOrigem(req({ Origin: "https://mal.example" }), false)).toThrow(
      /origem/i,
    );
  });
  it("formulário text/plain com JSON exigido: 415", () => {
    expect(() =>
      assertMesmaOrigem(req({ "Content-Type": "text/plain;application/json" }), true),
    ).toThrow(/JSON/);
  });
  it("mesma origem com JSON: passa", () => {
    expect(() =>
      assertMesmaOrigem(
        req({ Origin: "https://app.ceasapro.com.br", "Content-Type": "application/json" }),
        true,
      ),
    ).not.toThrow();
  });
});

describe("quantidade, preço e itens dentro do que a coluna guarda", () => {
  const item = { productId: "p", quantity: 1, unitPrice: 2 };
  it("quantidade com mais de 3 casas e preço com mais de 2 são recusados", () => {
    expect(vendaItemSchema.safeParse({ ...item, quantity: 1.0005 }).success).toBe(false);
    expect(vendaItemSchema.safeParse({ ...item, unitPrice: 2.345 }).success).toBe(false);
    expect(compraItemSchema.safeParse({ ...item, quantity: 0.0004 }).success).toBe(false);
  });
  it("ruído de ponto flutuante não derruba quantidade válida", () => {
    expect(vendaItemSchema.safeParse({ ...item, quantity: 0.1 + 0.2 }).success).toBe(true);
  });
  it("número gigante vira 400 com o campo marcado, não 500", () => {
    expect(vendaItemSchema.safeParse({ ...item, quantity: 1e12 }).success).toBe(false);
    expect(
      ajusteEstoqueSchema.safeParse({ productId: "p", type: "AJUSTE", quantity: 1, unitCost: 1e9 })
        .success,
    ).toBe(false);
  });
  it("limite de itens existe", () => {
    expect(ITENS_MAX).toBeGreaterThan(50);
  });
});

describe("conta recorrente de dia 31 não escorrega para 28 para sempre", () => {
  it("com o dia âncora, fevereiro encolhe e março volta ao 31", () => {
    const fev = proximoVencimento(new Date("2026-01-31T15:00:00Z"), 31);
    expect(civilParts(fev).day).toBe(28);
    const mar = proximoVencimento(fev, 31);
    expect(civilParts(mar).day).toBe(31);
  });
  it("sem âncora, mantém o comportamento de antes", () => {
    expect(civilParts(proximoVencimento(new Date("2026-03-10T15:00:00Z"))).day).toBe(10);
  });
});

describe("estorno de envio para higienização volta às SUJAS", () => {
  const zero: SaldoRow = {
    entrada_limpa: 0,
    entrada_suja: 0,
    entrada_quebrada: 0,
    entrada_quebrada_suja: 0,
    saida: 0,
    retorno: 0,
    saida_hig: 0,
    retorno_hig: 0,
    quebra_cliente: 0,
    quebra_higienizador: 0,
    quebra_limpa: 0,
    quebra_suja: 0,
    estorno_saida: 0,
    estorno_saida_hig: 0,
    venda: 0,
  };
  it("50 sujas, 50 enviadas, 10 estornadas: 10 sujas e 40 no higienizador", () => {
    const s = computeCrateSaldo({ ...zero, entrada_suja: 50, saida_hig: 50, estorno_saida_hig: 10 });
    expect(s.sujas).toBe(10);
    expect(s.emHigienizacao).toBe(40);
    expect(s.limpas).toBe(0);
  });
  it("não estorna mais do que está no higienizador", () => {
    const saldo = computeCrateSaldo({ ...zero, entrada_suja: 5, saida_hig: 5 });
    expect(() =>
      assertCrateMovement(saldo, {
        type: "ESTORNO_SAIDA_HIGIENIZACAO",
        quantity: 6,
        movementDate: "2026-10-21",
      } as never),
    ).toThrow();
  });
});

describe("perda de estoque entra no custo do mês", () => {
  it("custo do vendido soma CMV, embalagem e perdas (e o acerto para cima abate)", () => {
    expect(FinancialCalc.custoDoVendido(4000, 0, 1000).toNumber()).toBe(5000);
    expect(FinancialCalc.custoDoVendido(4000, 10, -200).toNumber()).toBe(3810);
    // O exemplo da auditoria: vendeu 80 cx a R$ 70, custo R$ 50, perdeu 20.
    const bruto = FinancialCalc.lucroBruto(5600, FinancialCalc.custoDoVendido(4000, 0, 1000));
    expect(bruto.toNumber()).toBe(600);
  });
});
