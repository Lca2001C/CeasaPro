import { describe, it, expect } from "vitest";
import { situacaoCobranca } from "@/lib/billing/status";

/**
 * Classificação de cobrança para acompanhamento no painel.
 *
 * O que estes testes protegem, e é a razão da função existir: a classificação
 * sai das DATAS, não do status gravado. O status gravado é atualizado pelo cron
 * uma vez por dia, então entre duas execuções ele afirma "ATIVO" para quem já
 * venceu — e uma tela de acompanhamento que repete essa afirmação esconde
 * exatamente o caso que o admin precisa ver.
 */

const AGORA = new Date("2026-09-02T12:00:00Z");
const dias = (n: number) => new Date(AGORA.getTime() + n * 24 * 60 * 60 * 1000);

/** Assinatura padrão: paga, dentro do período. Cada teste muda o que importa. */
const base = {
  status: "ATIVO" as const,
  statusSource: "AUTO" as const,
  activatedAt: new Date("2026-01-10T00:00:00Z"),
  trialEndsAt: null as Date | null,
  currentPeriodEnd: dias(10),
  graceDays: 5,
  cancelledAt: null as Date | null,
};

describe("situacaoCobranca — quem está pagando", () => {
  it("dentro do período pago → em dia", () => {
    const r = situacaoCobranca(base, AGORA);
    expect(r.situacao).toBe("em_dia");
    expect(r.statusEfetivo).toBe("ATIVO");
    expect(r.diasDeTeste).toBeNull();
  });

  it("último dia do período ainda é em dia", () => {
    const r = situacaoCobranca({ ...base, currentPeriodEnd: dias(0) }, AGORA);
    expect(r.situacao).toBe("em_dia");
  });
});

describe("situacaoCobranca — quem está em teste", () => {
  it("teste correndo → em teste, com os dias restantes", () => {
    const r = situacaoCobranca(
      { ...base, status: "TRIAL", activatedAt: null, trialEndsAt: dias(5) },
      AGORA,
    );
    expect(r.situacao).toBe("em_teste");
    expect(r.statusEfetivo).toBe("TRIAL");
    expect(r.diasDeTeste).toBe(5);
  });

  it("último dia do teste conta como 0 dia restante, não como vencido", () => {
    const r = situacaoCobranca(
      { ...base, status: "TRIAL", activatedAt: null, trialEndsAt: dias(0) },
      AGORA,
    );
    expect(r.situacao).toBe("em_teste");
    expect(r.diasDeTeste).toBe(0);
  });

  it("teste terminado e nunca pagou → inadimplente, NÃO em teste", () => {
    const r = situacaoCobranca(
      { ...base, status: "TRIAL", activatedAt: null, trialEndsAt: dias(-1) },
      AGORA,
    );
    expect(r.situacao).toBe("inadimplente");
    // Nunca VENCIDO: VENCIDO carrega direito à tolerância, que é só de quem pagou.
    expect(r.statusEfetivo).toBe("SUSPENSO");
    expect(r.diasDeTeste).toBeNull();
  });

  it("nunca teve teste e nunca pagou → inadimplente", () => {
    const r = situacaoCobranca(
      { ...base, status: "SUSPENSO", activatedAt: null, trialEndsAt: null },
      AGORA,
    );
    expect(r.situacao).toBe("inadimplente");
    expect(r.statusEfetivo).toBe("SUSPENSO");
  });
});

describe("situacaoCobranca — quem não está pagando", () => {
  it("vencido dentro da tolerância → inadimplente, com o grau preservado", () => {
    const r = situacaoCobranca({ ...base, currentPeriodEnd: dias(-2) }, AGORA);
    expect(r.situacao).toBe("inadimplente");
    // A diferença importa: VENCIDO ainda entra no sistema e uma cobrança resolve.
    expect(r.statusEfetivo).toBe("VENCIDO");
  });

  it("passou da tolerância → inadimplente e já sem acesso", () => {
    const r = situacaoCobranca({ ...base, currentPeriodEnd: dias(-10) }, AGORA);
    expect(r.situacao).toBe("inadimplente");
    expect(r.statusEfetivo).toBe("SUSPENSO");
  });

  it("assinatura cancelada ainda no período pago → em dia (acesso até o vencimento)", () => {
    const r = situacaoCobranca({ ...base, cancelledAt: dias(-1) }, AGORA);
    expect(r.situacao).toBe("em_dia");
    expect(r.statusEfetivo).toBe("ATIVO");
  });

  it("assinatura cancelada depois do vencimento → inadimplente, com o motivo visível", () => {
    const r = situacaoCobranca(
      { ...base, cancelledAt: dias(-1), currentPeriodEnd: dias(-1) },
      AGORA,
    );
    expect(r.situacao).toBe("inadimplente");
    expect(r.statusEfetivo).toBe("CANCELADO");
  });

  it("empresa sem assinatura nenhuma não é 'em dia'", () => {
    const r = situacaoCobranca(null, AGORA);
    expect(r.situacao).toBe("inadimplente");
    expect(r.statusEfetivo).toBeNull();
  });
});

describe("situacaoCobranca — o status gravado não manda", () => {
  it("gravado ATIVO com período vencido é classificado pela DATA", () => {
    // É o caso real: o cron ainda não rodou hoje. Confiar na coluna mostraria
    // "pagamento em dia" para quem venceu de madrugada.
    const r = situacaoCobranca({ ...base, status: "ATIVO", currentPeriodEnd: dias(-30) }, AGORA);
    expect(r.situacao).toBe("inadimplente");
    expect(r.statusEfetivo).toBe("SUSPENSO");
  });

  it("gravado SUSPENSO com período em aberto também é classificado pela DATA", () => {
    const r = situacaoCobranca({ ...base, status: "SUSPENSO", currentPeriodEnd: dias(10) }, AGORA);
    expect(r.situacao).toBe("em_dia");
    expect(r.statusEfetivo).toBe("ATIVO");
  });

  it("override MANUAL do super-admin é respeitado contra as datas", () => {
    // O ambiente próprio do admin depende disto: nasce ATIVO/MANUAL para o cron
    // não expirá-lo. Recalcular por cima marcaria o painel como inadimplente.
    const r = situacaoCobranca(
      { ...base, status: "ATIVO", statusSource: "MANUAL", currentPeriodEnd: dias(-90) },
      AGORA,
    );
    expect(r.situacao).toBe("em_dia");
    expect(r.statusEfetivo).toBe("ATIVO");
  });

  it("MANUAL marcado como TRIAL sem data não inventa contagem de dias", () => {
    const r = situacaoCobranca(
      { ...base, status: "TRIAL", statusSource: "MANUAL", trialEndsAt: null },
      AGORA,
    );
    expect(r.situacao).toBe("em_teste");
    expect(r.diasDeTeste).toBeNull();
  });
});
