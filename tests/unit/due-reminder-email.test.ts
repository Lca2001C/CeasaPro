import { describe, it, expect } from "vitest";
import { subscriptionDueSoonEmail } from "@/lib/email";
import { assertBancoDeTesteSeguro } from "../setup/guard-database";

describe("subscriptionDueSoonEmail", () => {
  const base = {
    ownerName: "Maria",
    tradeName: "Hortifruti São João",
    amount: "149.90",
    dueDate: new Date("2026-09-04T12:00:00.000Z"),
    daysAhead: 3,
    graceDays: 5,
    appUrl: "https://ceasapro.com.br",
  };

  it("diz o prazo, o valor e leva direto para o pagamento", () => {
    const { subject, html } = subscriptionDueSoonEmail(base);
    expect(subject).toContain("em 3 dias");
    expect(html).toContain("R$");
    expect(html).toContain("149,90");
    expect(html).toContain("https://ceasapro.com.br/assinatura");
    expect(html).toContain("5 dia(s) de tolerância");
  });

  it('usa "amanhã" em vez de "em 1 dias"', () => {
    const { subject } = subscriptionDueSoonEmail({ ...base, daysAhead: 1 });
    expect(subject).toContain("amanhã");
    expect(subject).not.toContain("1 dias");
  });

  it("sem tolerância, não promete prazo extra", () => {
    const { html } = subscriptionDueSoonEmail({ ...base, graceDays: 0 });
    expect(html).not.toContain("tolerância");
    expect(html).toContain("bloqueado até a regularização");
  });

  it("escapa o nome da empresa (não injeta HTML)", () => {
    const { html } = subscriptionDueSoonEmail({
      ...base,
      tradeName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("trava do banco de testes", () => {
  const local = { DATABASE_URL: "postgresql://u:p@localhost:5432/ceasapro" };

  it("aceita banco local", () => {
    expect(() => assertBancoDeTesteSeguro(local)).not.toThrow();
    expect(() =>
      assertBancoDeTesteSeguro({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x" }),
    ).not.toThrow();
  });

  it("recusa banco remoto e diz qual host encontrou", () => {
    expect(() =>
      assertBancoDeTesteSeguro({
        DATABASE_URL: "postgresql://u:p@ep-algo-pooler.aws.neon.tech/neondb",
      }),
    ).toThrow(/ep-algo-pooler\.aws\.neon\.tech/);
  });

  it("permite banco remoto com a liberação explícita", () => {
    expect(() =>
      assertBancoDeTesteSeguro({
        DATABASE_URL: "postgresql://u:p@ep-algo.aws.neon.tech/neondb",
        ALLOW_REMOTE_TEST_DB: "1",
      }),
    ).not.toThrow();
  });

  it("recusa DATABASE_URL ausente ou ilegível", () => {
    expect(() => assertBancoDeTesteSeguro({})).toThrow(/DATABASE_URL não definida/);
    expect(() => assertBancoDeTesteSeguro({ DATABASE_URL: "isto-nao-e-url" })).toThrow(/inválida/);
  });
});
