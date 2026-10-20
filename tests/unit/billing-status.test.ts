import { describe, it, expect } from "vitest";
import { computeStatus, accessDecision, inicioDoPeriodoPago } from "@/lib/billing/status";
import type { SubscriptionStatus, StatusSource } from "@prisma/client";

const NOW = new Date("2026-07-15T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

/** Fixture de assinatura JÁ ATIVADA — `activatedAt` no passado. O caso de quem
 *  nunca pagou tem suíte própria em `billing-no-trial.test.ts`. */
function sub(over: Partial<{
  status: SubscriptionStatus;
  statusSource: StatusSource;
  activatedAt: Date | null;
  currentPeriodEnd: Date;
  graceDays: number;
  cancelledAt: Date | null;
}>) {
  return {
    status: "ATIVO" as SubscriptionStatus,
    statusSource: "AUTO" as StatusSource,
    activatedAt: days(-60),
    currentPeriodEnd: days(10),
    graceDays: 5,
    cancelledAt: null,
    ...over,
  };
}

describe("computeStatus — ciclo de vida da assinatura", () => {
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

  it("exatamente no vencimento ainda é ATIVO (o dia do vencimento é do cliente)", () => {
    expect(computeStatus(sub({ currentPeriodEnd: NOW }), NOW)).toBe("ATIVO");
  });

  it("exatamente no fim da tolerância ainda é VENCIDO; um dia depois, SUSPENSO", () => {
    expect(computeStatus(sub({ currentPeriodEnd: days(-5), graceDays: 5 }), NOW)).toBe("VENCIDO");
    expect(computeStatus(sub({ currentPeriodEnd: days(-6), graceDays: 5 }), NOW)).toBe("SUSPENSO");
  });

  it("sem tolerância (graceDays 0): vence e suspende no mesmo instante", () => {
    expect(computeStatus(sub({ currentPeriodEnd: days(-1), graceDays: 0 }), NOW)).toBe("SUSPENSO");
    expect(computeStatus(sub({ currentPeriodEnd: NOW, graceDays: 0 }), NOW)).toBe("ATIVO");
  });

  it("override MANUAL do super-admin prevalece sobre as datas", () => {
    expect(
      computeStatus(
        sub({ status: "BLOQUEADO", statusSource: "MANUAL", currentPeriodEnd: days(30) }),
        NOW,
      ),
    ).toBe("BLOQUEADO");
  });

  it("cancelada no período pago → ATIVO até o vencimento (Termos §5)", () => {
    expect(
      computeStatus(sub({ cancelledAt: days(-1), currentPeriodEnd: days(30) }), NOW),
    ).toBe("ATIVO");
  });

  it("cancelada depois do vencimento → CANCELADO, sem tolerância", () => {
    expect(
      computeStatus(
        sub({ cancelledAt: days(-1), currentPeriodEnd: days(-2), graceDays: 5 }),
        NOW,
      ),
    ).toBe("CANCELADO");
  });

  it("estorno MANUAL vence o cancelamento ainda no período", () => {
    expect(
      computeStatus(
        sub({
          cancelledAt: days(-1),
          currentPeriodEnd: days(30),
          status: "SUSPENSO",
          statusSource: "MANUAL",
        }),
        NOW,
      ),
    ).toBe("SUSPENSO");
  });
});

describe("accessDecision — o que cada status permite", () => {
  it("ATIVO → ok", () => {
    expect(accessDecision("ACTIVE", "ATIVO")).toBe("ok");
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

describe("inicioDoPeriodoPago — onde começa o mês comprado", () => {
  const vence = new Date("2026-10-01T03:00:00Z");
  const base = {
    activatedAt: new Date("2026-08-01T03:00:00Z"),
    currentPeriodEnd: vence,
    graceDays: 5,
    statusSource: "AUTO" as StatusSource,
    cancelledAt: null,
  };

  it("renovação adiantada: no vencimento", () => {
    expect(inicioDoPeriodoPago(base, new Date("2026-09-29T12:00:00Z"))).toEqual(vence);
  });

  it("paga DENTRO da tolerância: no vencimento — a tolerância não sai de graça", () => {
    // Recomeçar no dia 06 daria 5 dias grátis a cada mês.
    expect(inicioDoPeriodoPago(base, new Date("2026-10-05T12:00:00Z"))).toEqual(vence);
  });

  it("paga depois de ficar sem acesso: hoje — os dias bloqueados não são cobrados", () => {
    const hoje = new Date("2026-10-20T12:00:00Z");
    expect(inicioDoPeriodoPago(base, hoje)).toEqual(hoje);
  });

  it("primeiro pagamento, estorno ou cancelamento: hoje", () => {
    const hoje = new Date("2026-10-03T12:00:00Z");
    expect(inicioDoPeriodoPago({ ...base, activatedAt: null }, hoje)).toEqual(hoje);
    expect(inicioDoPeriodoPago({ ...base, statusSource: "MANUAL" }, hoje)).toEqual(hoje);
    expect(inicioDoPeriodoPago({ ...base, cancelledAt: new Date("2026-09-10") }, hoje)).toEqual(hoje);
  });
});
