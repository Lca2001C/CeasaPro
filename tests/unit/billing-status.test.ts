import { describe, it, expect } from "vitest";
import { computeStatus, accessDecision } from "@/lib/billing/status";
import type { SubscriptionStatus, StatusSource } from "@prisma/client";

const NOW = new Date("2026-07-15T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

function sub(over: Partial<{
  status: SubscriptionStatus;
  statusSource: StatusSource;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
  graceDays: number;
  cancelledAt: Date | null;
}>) {
  return {
    status: "ATIVO" as SubscriptionStatus,
    statusSource: "AUTO" as StatusSource,
    trialEndsAt: null,
    currentPeriodEnd: days(10),
    graceDays: 5,
    cancelledAt: null,
    ...over,
  };
}

describe("computeStatus — ciclo de vida da assinatura", () => {
  it("trial vigente → TRIAL", () => {
    expect(computeStatus(sub({ trialEndsAt: days(3) }), NOW)).toBe("TRIAL");
  });

  it("dentro do vencimento → ATIVO", () => {
    expect(computeStatus(sub({ currentPeriodEnd: days(1) }), NOW)).toBe("ATIVO");
  });

  it("vencida dentro da tolerância → VENCIDO (acesso com aviso)", () => {
    expect(
      computeStatus(sub({ currentPeriodEnd: days(-2), graceDays: 5 }), NOW),
    ).toBe("VENCIDO");
  });

  it("vencida além da tolerância → SUSPENSO (bloqueio)", () => {
    expect(
      computeStatus(sub({ currentPeriodEnd: days(-10), graceDays: 5 }), NOW),
    ).toBe("SUSPENSO");
  });

  it("override MANUAL do super-admin prevalece sobre as datas", () => {
    expect(
      computeStatus(
        sub({ status: "BLOQUEADO", statusSource: "MANUAL", currentPeriodEnd: days(30) }),
        NOW,
      ),
    ).toBe("BLOQUEADO");
  });

  it("cancelada → CANCELADO, mesmo com datas em dia", () => {
    expect(
      computeStatus(sub({ cancelledAt: days(-1), currentPeriodEnd: days(30) }), NOW),
    ).toBe("CANCELADO");
  });
});

describe("accessDecision — o que cada status permite", () => {
  it("ATIVO/TRIAL → ok", () => {
    expect(accessDecision("ACTIVE", "ATIVO")).toBe("ok");
    expect(accessDecision("ACTIVE", "TRIAL")).toBe("ok");
  });
  it("VENCIDO → warn (acesso com aviso de pagamento)", () => {
    expect(accessDecision("ACTIVE", "VENCIDO")).toBe("warn");
  });
  it("SUSPENSO/BLOQUEADO/CANCELADO → blocked", () => {
    expect(accessDecision("ACTIVE", "SUSPENSO")).toBe("blocked");
    expect(accessDecision("ACTIVE", "BLOQUEADO")).toBe("blocked");
    expect(accessDecision("ACTIVE", "CANCELADO")).toBe("blocked");
  });
  it("empresa suspensa/bloqueada pelo super-admin → blocked, mesmo com assinatura ATIVA", () => {
    expect(accessDecision("SUSPENDED", "ATIVO")).toBe("blocked");
    expect(accessDecision("BLOCKED", "ATIVO")).toBe("blocked");
  });
});
