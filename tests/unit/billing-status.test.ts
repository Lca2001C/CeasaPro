import { describe, it, expect } from "vitest";
import { accessDecision, addOneMonth, computeStatus } from "@/lib/billing/status";
import { mapMpStatus } from "@/lib/services/billing.service";

const base = {
  status: "ATIVO" as const,
  statusSource: "AUTO" as const,
  trialEndsAt: null,
  currentPeriodEnd: new Date("2026-08-10T00:00:00.000Z"),
  graceDays: 5,
  cancelledAt: null,
};

describe("computeStatus", () => {
  it("dentro do período → ATIVO", () => {
    expect(computeStatus(base, new Date("2026-08-09T00:00:00.000Z"))).toBe("ATIVO");
  });

  it("no último dia do período ainda é ATIVO", () => {
    expect(computeStatus(base, new Date("2026-08-10T00:00:00.000Z"))).toBe("ATIVO");
  });

  it("dentro da carência → VENCIDO", () => {
    expect(computeStatus(base, new Date("2026-08-13T00:00:00.000Z"))).toBe("VENCIDO");
  });

  it("no fim da carência ainda é VENCIDO", () => {
    expect(computeStatus(base, new Date("2026-08-15T00:00:00.000Z"))).toBe("VENCIDO");
  });

  it("passada a carência → SUSPENSO", () => {
    expect(computeStatus(base, new Date("2026-08-16T00:00:00.000Z"))).toBe("SUSPENSO");
  });

  it("trial vigente vence qualquer data de período", () => {
    const trial = { ...base, trialEndsAt: new Date("2026-09-01T00:00:00.000Z") };
    expect(computeStatus(trial, new Date("2026-08-20T00:00:00.000Z"))).toBe("TRIAL");
  });

  it("cancelamento vence tudo", () => {
    const cancelada = { ...base, cancelledAt: new Date("2026-01-01T00:00:00.000Z") };
    expect(computeStatus(cancelada, new Date("2026-08-01T00:00:00.000Z"))).toBe("CANCELADO");
  });

  it("override manual do super-admin é respeitado", () => {
    const manual = { ...base, statusSource: "MANUAL" as const, status: "ATIVO" as const };
    expect(computeStatus(manual, new Date("2027-01-01T00:00:00.000Z"))).toBe("ATIVO");
  });
});

describe("accessDecision", () => {
  it("empresa suspensa ou bloqueada → blocked", () => {
    expect(accessDecision("SUSPENDED", "ATIVO")).toBe("blocked");
    expect(accessDecision("BLOCKED", "ATIVO")).toBe("blocked");
  });

  it("assinatura suspensa/bloqueada/cancelada → blocked", () => {
    expect(accessDecision("ACTIVE", "SUSPENSO")).toBe("blocked");
    expect(accessDecision("ACTIVE", "BLOQUEADO")).toBe("blocked");
    expect(accessDecision("ACTIVE", "CANCELADO")).toBe("blocked");
  });

  it("vencida na carência → warn (usa o sistema com aviso)", () => {
    expect(accessDecision("ACTIVE", "VENCIDO")).toBe("warn");
  });

  it("ativa ou em trial → ok", () => {
    expect(accessDecision("ACTIVE", "ATIVO")).toBe("ok");
    expect(accessDecision("ACTIVE", "TRIAL")).toBe("ok");
  });
});

describe("addOneMonth", () => {
  const proximo = (iso: string) => addOneMonth(new Date(iso)).toISOString();

  it("mês cheio avança normalmente", () => {
    expect(proximo("2026-08-10T00:00:00.000Z")).toBe("2026-09-10T00:00:00.000Z");
  });

  it("não vaza para o mês seguinte quando o dia não existe no destino", () => {
    // setMonth nativo daria 01/10 e 03/03 — dias grátis a cada renovação.
    expect(proximo("2026-08-31T00:00:00.000Z")).toBe("2026-09-30T00:00:00.000Z");
    expect(proximo("2026-01-31T00:00:00.000Z")).toBe("2026-02-28T00:00:00.000Z");
    expect(proximo("2026-05-31T00:00:00.000Z")).toBe("2026-06-30T00:00:00.000Z");
  });

  it("respeita ano bissexto", () => {
    expect(proximo("2028-01-31T00:00:00.000Z")).toBe("2028-02-29T00:00:00.000Z");
  });

  it("vira o ano corretamente", () => {
    expect(proximo("2026-12-15T12:30:00.000Z")).toBe("2027-01-15T12:30:00.000Z");
  });

  it("preserva o horário", () => {
    expect(proximo("2026-03-15T08:45:30.000Z")).toBe("2026-04-15T08:45:30.000Z");
  });
});

describe("mapMpStatus", () => {
  it("mapeia os status do Mercado Pago", () => {
    expect(mapMpStatus("approved")).toBe("APROVADO");
    expect(mapMpStatus("rejected")).toBe("RECUSADO");
    expect(mapMpStatus("refunded")).toBe("ESTORNADO");
    expect(mapMpStatus("charged_back")).toBe("ESTORNADO");
    expect(mapMpStatus("cancelled")).toBe("CANCELADO");
  });

  it("qualquer status intermediário continua PENDENTE", () => {
    expect(mapMpStatus("pending")).toBe("PENDENTE");
    expect(mapMpStatus("in_process")).toBe("PENDENTE");
    expect(mapMpStatus("authorized")).toBe("PENDENTE");
    expect(mapMpStatus("")).toBe("PENDENTE");
  });
});
