import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A action que registra devolução de caixas plásticas exige o módulo pago?
 *
 * `registrarDevolucaoCaixas` mora em `src/actions/fiado.actions.ts` — um
 * arquivo de NÚCLEO — e escreve em `PlasticCrateMovement`, que é recurso do
 * módulo opcional `caixas`. Era o ponto cego de
 * `tests/unit/actions-module-gate.test.ts`, que varre apenas os quatro
 * arquivos cujo nome é o do módulo.
 *
 * O mesmo recurso já é gateado no caminho da venda
 * (`vendas.service.ts`, `isModuleEnabled(ctx.session.modules, "caixas")`), com
 * o motivo escrito lá: "empresa sem o módulo de caixas não deve ter movimento
 * de caixa criado pelas costas".
 *
 * **Isto não era um furo explorável, e vale registrar o porquê.** O invariante
 * de negócio já barrava na prática: `assertCrateMovement` recusa `RETORNO`
 * acima do saldo do cliente, e empresa sem o módulo tem saldo zero. O problema
 * é que a proteção vinha de um ACIDENTE — relaxar aquele limite abriria a
 * porta em silêncio — e a mensagem que a pessoa recebia era "Fulano está com 0
 * caixa(s). Confira o nome e a quantidade", em vez de dizer que o módulo não
 * está no plano.
 */

const requireTenant = vi.fn();
const registrarDevolucao = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireTenant: () => requireTenant(),
  requireSuperAdmin: vi.fn(),
}));
vi.mock("@/lib/auth/revogacao", () => ({ assertSessaoValida: vi.fn() }));
vi.mock("@/lib/http/request", () => ({ clientIp: () => Promise.resolve(null) }));
vi.mock("@/lib/services/fiado.service", () => ({
  FiadoService: {
    registrarDevolucaoCaixas: (...a: unknown[]) => registrarDevolucao(...a),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const { registrarDevolucaoCaixas } = await import("@/actions/fiado.actions");

function sessao(modules: string[]) {
  return {
    session: {
      sub: "user-1",
      role: "OWNER",
      tenantId: "empresa-A",
      email: "dono@box.com",
      name: "Dono",
      tenantStatus: "ACTIVE",
      subStatus: "ATIVO",
      modules,
      mustChangePassword: false,
    },
    tenantId: "empresa-A",
  };
}

const ENTRADA = { accountId: "conta-1", quantity: 2, movementDate: "2026-09-10" };

beforeEach(() => {
  registrarDevolucao.mockResolvedValue({ id: "mov-1", quantity: 2 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("registrarDevolucaoCaixas — gate do módulo pago", () => {
  it("empresa SEM o módulo é recusada, e o serviço nem é chamado", async () => {
    requireTenant.mockResolvedValue(sessao(["cotacoes", "higienizacao"]));

    const r = await registrarDevolucaoCaixas(ENTRADA);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    // O que mais importa: o movimento não chega a ser criado.
    expect(registrarDevolucao).not.toHaveBeenCalled();
  });

  it("a recusa fala do PLANO, não do saldo do cliente", async () => {
    /*
      Antes do gate, quem não tinha o módulo recebia "Fulano está com 0
      caixa(s). Confira o nome e a quantidade" — vindo do invariante de saldo.
      A pessoa conferia o nome, conferia a quantidade, e nunca descobria que o
      problema era o plano.
    */
    requireTenant.mockResolvedValue(sessao([]));

    const r = await registrarDevolucaoCaixas(ENTRADA);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).not.toMatch(/caixa\(s\)|confira o nome/i);
  });

  it("é fail-closed: sessão sem a lista de módulos também é recusada", async () => {
    requireTenant.mockResolvedValue(sessao(undefined as unknown as string[]));

    const r = await registrarDevolucaoCaixas(ENTRADA);

    expect(r.ok).toBe(false);
    expect(registrarDevolucao).not.toHaveBeenCalled();
  });

  it("empresa COM o módulo passa normalmente", async () => {
    requireTenant.mockResolvedValue(sessao(["caixas"]));

    const r = await registrarDevolucaoCaixas(ENTRADA);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ id: "mov-1", quantity: 2 });
    expect(registrarDevolucao).toHaveBeenCalledTimes(1);
  });
});
