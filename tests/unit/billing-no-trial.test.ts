import { describe, it, expect } from "vitest";
import { computeStatus, accessDecision, addOneMonth } from "@/lib/billing/status";
import type { SubscriptionStatus, StatusSource } from "@prisma/client";

/**
 * Regra de negócio central do Go-Live: o CeasaPro não dá nenhum dia de uso
 * gratuito. Enquanto `activatedAt` for nulo, a empresa não acessa nada —
 * nem pela data de vencimento, nem pela tolerância de `graceDays`.
 */

const NOW = new Date("2026-08-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

function sub(over: Partial<{
  status: SubscriptionStatus;
  statusSource: StatusSource;
  activatedAt: Date | null;
  currentPeriodEnd: Date;
  graceDays: number;
  cancelledAt: Date | null;
}>) {
  return {
    status: "SUSPENSO" as SubscriptionStatus,
    statusSource: "AUTO" as StatusSource,
    activatedAt: null as Date | null,
    currentPeriodEnd: NOW,
    graceDays: 5,
    cancelledAt: null as Date | null,
    ...over,
  };
}

describe("Empresa recém-cadastrada (nunca pagou)", () => {
  it("nasce SUSPENSA, mesmo com o vencimento no futuro", () => {
    // Cenário perigoso: se alguém gravar um currentPeriodEnd generoso na criação,
    // isso não pode virar acesso gratuito.
    expect(computeStatus(sub({ currentPeriodEnd: days(30) }), NOW)).toBe("SUSPENSO");
  });

  it("não ganha a tolerância de graceDays", () => {
    expect(computeStatus(sub({ currentPeriodEnd: days(-2), graceDays: 5 }), NOW)).toBe("SUSPENSO");
  });

  it("continua bloqueada mesmo com graceDays alto", () => {
    expect(computeStatus(sub({ currentPeriodEnd: days(-1), graceDays: 60 }), NOW)).toBe("SUSPENSO");
  });

  it("tem o acesso negado por accessDecision", () => {
    const status = computeStatus(sub({ currentPeriodEnd: days(30) }), NOW);
    expect(accessDecision("ACTIVE", status)).toBe("blocked");
  });
});

describe("computeStatus nunca devolve TRIAL", () => {
  const cenarios: Array<[string, ReturnType<typeof sub>]> = [
    ["nova sem pagamento", sub({})],
    ["nova com vencimento futuro", sub({ currentPeriodEnd: days(15) })],
    ["ativada e em dia", sub({ activatedAt: days(-30), currentPeriodEnd: days(5) })],
    ["ativada e vencida", sub({ activatedAt: days(-60), currentPeriodEnd: days(-2) })],
    ["cancelada", sub({ activatedAt: days(-60), cancelledAt: days(-1) })],
  ];

  for (const [nome, fixture] of cenarios) {
    it(`${nome} → status válido, fora do trial`, () => {
      const status = computeStatus(fixture, NOW);
      expect(status).not.toBe("TRIAL");
      expect(["ATIVO", "VENCIDO", "SUSPENSO", "BLOQUEADO", "CANCELADO"]).toContain(status);
    });
  }
});

describe("Ciclo depois da primeira ativação", () => {
  const ativada = (over = {}) => sub({ activatedAt: days(-30), ...over });

  it("dentro do período pago → ATIVO", () => {
    expect(computeStatus(ativada({ currentPeriodEnd: days(10) }), NOW)).toBe("ATIVO");
  });

  it("vencida dentro da tolerância → VENCIDO (acesso com aviso)", () => {
    const status = computeStatus(ativada({ currentPeriodEnd: days(-3), graceDays: 5 }), NOW);
    expect(status).toBe("VENCIDO");
    expect(accessDecision("ACTIVE", status)).toBe("warn");
  });

  it("passada a tolerância → SUSPENSO (bloqueio)", () => {
    const status = computeStatus(ativada({ currentPeriodEnd: days(-10), graceDays: 5 }), NOW);
    expect(status).toBe("SUSPENSO");
    expect(accessDecision("ACTIVE", status)).toBe("blocked");
  });

  it("bloqueio manual por chargeback prevalece sobre as datas", () => {
    const status = computeStatus(
      ativada({ status: "BLOQUEADO", statusSource: "MANUAL", currentPeriodEnd: days(20) }),
      NOW,
    );
    expect(status).toBe("BLOQUEADO");
    expect(accessDecision("ACTIVE", status)).toBe("blocked");
  });
});

describe("Primeiro ciclo a partir do pagamento", () => {
  it("uma empresa nova paga hoje e passa a valer por um mês a partir de hoje", () => {
    // Reproduz o cálculo de `applyPaymentStatus`: quando o vencimento antigo
    // está no passado, a base é `now` — senão o mês pago nasceria vencido.
    const currentPeriodEnd = days(-40);
    const base = currentPeriodEnd > NOW ? currentPeriodEnd : NOW;
    const novoVencimento = addOneMonth(base);

    expect(novoVencimento.getTime()).toBeGreaterThan(NOW.getTime());
    expect(computeStatus(sub({ activatedAt: NOW, currentPeriodEnd: novoVencimento }), NOW)).toBe(
      "ATIVO",
    );
  });
});
