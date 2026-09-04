import { describe, it, expect } from "vitest";
import {
  computeStatus,
  accessDecision,
  addOneMonth,
  billingNotice,
  trialDaysLeft,
  trialEndFrom,
  TRIAL_DAYS,
  TRIAL_WARN_DAYS,
} from "@/lib/billing/status";
import type { SubscriptionStatus, StatusSource } from "@prisma/client";

/**
 * Regra central de acesso do CeasaPro, depois da reintrodução do teste grátis.
 *
 * Substitui `billing-no-trial.test.ts`, que fixava a regra do Go-Live ("nenhum
 * dia de uso gratuito"). O que aquele arquivo protegia e CONTINUA valendo está
 * preservado aqui:
 *  - sem `activatedAt` e sem trial → SUSPENSO;
 *  - `graceDays` nunca vale para quem não pagou;
 *  - `currentPeriodEnd` generoso não abre acesso antes do 1º pagamento;
 *  - override MANUAL vence as datas.
 *
 * O que mudou: existe UM caminho de acesso sem pagamento, o trial, e ele é regido
 * só por `trialEndsAt`.
 */

const NOW = new Date("2026-08-31T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

function sub(
  over: Partial<{
    status: SubscriptionStatus;
    statusSource: StatusSource;
    activatedAt: Date | null;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date;
    graceDays: number;
    cancelledAt: Date | null;
  }>,
) {
  return {
    status: "SUSPENSO" as SubscriptionStatus,
    statusSource: "AUTO" as StatusSource,
    activatedAt: null as Date | null,
    trialEndsAt: null as Date | null,
    currentPeriodEnd: NOW,
    graceDays: 5,
    cancelledAt: null as Date | null,
    ...over,
  };
}

describe("Empresa sem pagamento E sem teste grátis", () => {
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

describe("Teste grátis de 7 dias", () => {
  it("cadastro confirmado HOJE tem acesso liberado", () => {
    const status = computeStatus(sub({ trialEndsAt: trialEndFrom(NOW) }), NOW);
    expect(status).toBe("TRIAL");
    expect(accessDecision("ACTIVE", status)).toBe("ok");
  });

  it("no último dia do teste ainda tem acesso", () => {
    const status = computeStatus(sub({ trialEndsAt: days(0.5) }), NOW);
    expect(status).toBe("TRIAL");
    expect(accessDecision("ACTIVE", status)).toBe("ok");
  });

  it("cadastro de 8 dias atrás, sem pagar, está BLOQUEADO", () => {
    // O cenário exato pedido: trial de 7 dias iniciado há 8 dias.
    const inicio = days(-8);
    const status = computeStatus(sub({ trialEndsAt: trialEndFrom(inicio) }), NOW);
    expect(status).toBe("SUSPENSO");
    expect(accessDecision("ACTIVE", status)).toBe("blocked");
  });

  it("teste vencido vira SUSPENSO, NUNCA VENCIDO", () => {
    // VENCIDO libera acesso com aviso — usá-lo aqui daria dias grátis além dos 7.
    const status = computeStatus(sub({ trialEndsAt: days(-1) }), NOW);
    expect(status).toBe("SUSPENSO");
    expect(status).not.toBe("VENCIDO");
  });

  it("graceDays NÃO estende o teste grátis", () => {
    // A tolerância cobre compensação bancária de cliente pagante; não é
    // prorrogação de teste.
    const status = computeStatus(
      sub({ trialEndsAt: days(-2), graceDays: 60, currentPeriodEnd: days(-2) }),
      NOW,
    );
    expect(status).toBe("SUSPENSO");
  });

  it("pagar durante o teste passa a valer o ciclo pago", () => {
    // `activatedAt` presente: o trial deixa de importar, mesmo ainda no prazo.
    const status = computeStatus(
      sub({ activatedAt: NOW, trialEndsAt: days(5), currentPeriodEnd: days(30) }),
      NOW,
    );
    expect(status).toBe("ATIVO");
  });

  it("cancelamento vence o teste em andamento", () => {
    const status = computeStatus(sub({ trialEndsAt: days(5), cancelledAt: days(-1) }), NOW);
    expect(status).toBe("CANCELADO");
    expect(accessDecision("ACTIVE", status)).toBe("blocked");
  });

  it("bloqueio MANUAL do super-admin vence o teste em andamento", () => {
    const status = computeStatus(
      sub({ trialEndsAt: days(5), status: "BLOQUEADO", statusSource: "MANUAL" }),
      NOW,
    );
    expect(status).toBe("BLOQUEADO");
    expect(accessDecision("ACTIVE", status)).toBe("blocked");
  });

  it("empresa suspensa pela plataforma não escapa pelo teste", () => {
    const status = computeStatus(sub({ trialEndsAt: days(5) }), NOW);
    expect(status).toBe("TRIAL");
    expect(accessDecision("SUSPENDED", status)).toBe("blocked");
  });

  it("trialEndFrom concede exatamente TRIAL_DAYS", () => {
    const fim = trialEndFrom(NOW);
    expect(trialDaysLeft(fim, NOW)).toBe(TRIAL_DAYS);
  });
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
    expect(
      computeStatus(sub({ activatedAt: NOW, currentPeriodEnd: novoVencimento }), NOW),
    ).toBe("ATIVO");
  });
});

describe("trialDaysLeft", () => {
  it("arredonda para cima — faltando 1,2 dias o cliente lê 2", () => {
    expect(trialDaysLeft(days(1.2), NOW)).toBe(2);
  });

  it("nunca devolve negativo", () => {
    expect(trialDaysLeft(days(-5), NOW)).toBe(0);
  });

  it("no instante exato do fim, zero", () => {
    expect(trialDaysLeft(NOW, NOW)).toBe(0);
  });
});

describe("billingNotice (banner do topo)", () => {
  it("silencioso no começo do teste", () => {
    expect(
      billingNotice({ subStatus: "TRIAL", trialEndsAt: trialEndFrom(NOW), now: NOW }),
    ).toBeNull();
  });

  it("silencioso com 3 dias restantes", () => {
    expect(billingNotice({ subStatus: "TRIAL", trialEndsAt: days(3), now: NOW })).toBeNull();
  });

  it(`avisa a partir de ${TRIAL_WARN_DAYS} dias restantes`, () => {
    expect(billingNotice({ subStatus: "TRIAL", trialEndsAt: days(2), now: NOW })).toEqual({
      kind: "trial_ending",
      daysLeft: 2,
    });
    expect(billingNotice({ subStatus: "TRIAL", trialEndsAt: days(0.5), now: NOW })).toEqual({
      kind: "trial_ending",
      daysLeft: 1,
    });
  });

  it("no último instante avisa com zero dias", () => {
    expect(billingNotice({ subStatus: "TRIAL", trialEndsAt: NOW, now: NOW })).toEqual({
      kind: "trial_ending",
      daysLeft: 0,
    });
  });

  it("mensalidade vencida é outro aviso, não o de teste", () => {
    expect(billingNotice({ subStatus: "VENCIDO", trialEndsAt: null, now: NOW })).toEqual({
      kind: "overdue",
    });
  });

  it("TRIAL sem trialEndsAt não anuncia nada (estado inconsistente)", () => {
    expect(billingNotice({ subStatus: "TRIAL", trialEndsAt: null, now: NOW })).toBeNull();
  });

  it("empresa ativa e em dia não vê banner", () => {
    expect(billingNotice({ subStatus: "ATIVO", trialEndsAt: null, now: NOW })).toBeNull();
  });

  it("cancelada no período pago avisa a data de corte, não pede pagamento", () => {
    expect(
      billingNotice({
        subStatus: "ATIVO",
        trialEndsAt: null,
        cancelledAt: days(-1),
        currentPeriodEnd: days(10),
        now: NOW,
      }),
    ).toEqual({ kind: "cancelled", accessUntil: days(10) });
  });

  it("já bloqueada não vê banner (a tela de bloqueio fala por si)", () => {
    expect(billingNotice({ subStatus: "SUSPENSO", trialEndsAt: days(-1), now: NOW })).toBeNull();
  });
});
