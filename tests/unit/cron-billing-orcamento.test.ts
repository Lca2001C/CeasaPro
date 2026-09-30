import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * O cron de billing tem 60 s para tudo, e a reconciliação com o Mercado Pago é
 * a única etapa que fala com a rede em volume. Estes testes guardam as duas
 * regras que impedem que ela leve o resto junto:
 *  - ela recebe um ORÇAMENTO (fatia do tempo da rota);
 *  - se ela falhar, as etapas locais rodam do mesmo jeito.
 */

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  recompute: vi.fn(),
  lembretes: vi.fn(),
  despesas: vi.fn(),
  importar: vi.fn(),
}));

vi.mock("@/lib/services/billing.service", () => ({
  BillingService: {
    reconcilePendingPayments: mocks.reconcile,
    recomputeStatuses: mocks.recompute,
    enviarLembretesDeVencimento: mocks.lembretes,
  },
}));
vi.mock("@/lib/services/despesas.service", () => ({
  gerarRecorrentesDeTodosOsTenants: mocks.despesas,
}));
vi.mock("@/lib/services/cotacoes-import.service", () => ({
  CotacoesImportService: {
    importarTodasAsCentrais: mocks.importar,
    verificarDefasagem: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("@/lib/security/rate-limit-db", () => ({
  purgeExpiredRateLimits: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/auth/refresh", () => ({
  purgeDeadRefreshTokens: vi.fn().mockResolvedValue(0),
}));

const { GET } = await import("@/app/api/cron/billing/route");

const SEGREDO = "segredo-do-cron-orcamento-123";
const pedido = () =>
  new Request("http://localhost/api/cron/billing", {
    headers: { authorization: `Bearer ${SEGREDO}` },
  });

let original: string | undefined;
beforeEach(() => {
  original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SEGREDO;
  mocks.reconcile.mockResolvedValue({ verificados: 0, atualizados: 0 });
  mocks.recompute.mockResolvedValue({ total: 0, updated: 0, planosTrocados: 0 });
  mocks.lembretes.mockResolvedValue({ candidatos: 0, enviados: 0 });
  mocks.despesas.mockResolvedValue({ empresas: 0, geradas: 0 });
  mocks.importar.mockResolvedValue({ centrais: 0 });
});
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
  vi.clearAllMocks();
});

describe("cron/billing — orçamento da reconciliação", () => {
  it("passa um orçamento finito, bem abaixo do teto da rota", async () => {
    await GET(pedido());
    const [opts] = mocks.reconcile.mock.calls[0] as [{ orcamentoMs?: number }];
    expect(opts?.orcamentoMs).toBeGreaterThan(0);
    // Tem de sobrar tempo para status, lembretes, despesas, limpezas e boletins.
    expect(opts?.orcamentoMs).toBeLessThanOrEqual(25_000);
  });

  it("reconciliação que falha não derruba status, lembretes, despesas nem boletins", async () => {
    mocks.reconcile.mockRejectedValue(new Error("Mercado Pago fora do ar"));

    const r = await GET(pedido());

    expect(r.status).toBe(200);
    expect(mocks.recompute).toHaveBeenCalledTimes(1);
    expect(mocks.lembretes).toHaveBeenCalledTimes(1);
    expect(mocks.despesas).toHaveBeenCalledTimes(1);
    expect(mocks.importar).toHaveBeenCalledTimes(1);
    const corpo = (await r.json()) as { reconciliacao: unknown };
    expect(corpo.reconciliacao).toEqual({ erro: "falhou" });
  });

  it("a reconciliação continua ANTES do recálculo de status", async () => {
    const ordem: string[] = [];
    mocks.reconcile.mockImplementation(async () => {
      ordem.push("reconcilia");
      return { verificados: 0, atualizados: 0 };
    });
    mocks.recompute.mockImplementation(async () => {
      ordem.push("recalcula");
      return { total: 0, updated: 0, planosTrocados: 0 };
    });
    await GET(pedido());
    expect(ordem).toEqual(["reconcilia", "recalcula"]);
  });
});
