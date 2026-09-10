import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

/**
 * O wrapper das Server Actions — a barreira que ninguém executava.
 *
 * `withTenantAction` decide, ANTES de o handler rodar: se há sessão, se a
 * sessão não foi revogada, se a assinatura está ativa, se o plano inclui o
 * módulo, e se a entrada passa no Zod. São as regras 1 e 7 do briefing
 * (`docs/CONTEXTO-AGENTE.md`) — isolamento por tenant e gating no servidor —
 * e as 13 Server Actions do sistema dependem inteiramente dele.
 *
 * **Até esta suíte existir, ele nunca era executado por nenhum teste.** A
 * medição de cobertura mostrou `src/lib/http` em 18,3%. A única verificação
 * era `tests/unit/actions-module-gate.test.ts`, que lê o TEXTO de 4 dos 13
 * arquivos de action e confere por regex se a chave `module:` está escrita —
 * o que prova que alguém digitou a palavra, não que ela faz efeito.
 *
 * O motivo da lacuna é conhecido e está no próprio ferramental de teste:
 * `makeCtx()` (`tests/helpers/factory.ts`) fabrica um `TenantCtx` pronto com
 * `modules: [...ALL_OPTIONAL_KEYS]`, então todo teste de integração chama o
 * serviço por baixo e o wrapper fica fora do caminho. Isto aqui é o
 * complemento: testa o wrapper SOZINHO, com a sessão sob controle.
 *
 * Por isso quase todo caso abaixo afirma que **o handler NÃO rodou**. Um gate
 * que devolve o erro certo mas executa o efeito colateral antes não é um gate.
 */

const requireTenant = vi.fn();
const requireSuperAdmin = vi.fn();
const assertSessaoValida = vi.fn();
const clientIp = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireTenant: () => requireTenant(),
  requireSuperAdmin: () => requireSuperAdmin(),
}));
vi.mock("@/lib/auth/revogacao", () => ({
  assertSessaoValida: (s: unknown) => assertSessaoValida(s),
}));
vi.mock("@/lib/http/request", () => ({
  clientIp: () => clientIp(),
}));

const { withTenantAction, withAdminAction } = await import("@/lib/http/with-action");
const { ForbiddenError, NotFoundError } = await import("@/lib/http/app-error");

/** Sessão de OWNER saudável: empresa ativa, assinatura ativa, todos os módulos. */
function sessaoOk(over: Record<string, unknown> = {}) {
  return {
    sub: "user-1",
    role: "OWNER",
    tenantId: "empresa-A",
    email: "dono@box.com",
    name: "Dono",
    tenantStatus: "ACTIVE",
    subStatus: "ATIVO",
    modules: ["caixas", "higienizacao", "embalagens", "cotacoes", "relatorios_avancados"],
    mustChangePassword: false,
    sev: 0,
    tev: 0,
    ...over,
  };
}

beforeEach(() => {
  requireTenant.mockResolvedValue({ session: sessaoOk(), tenantId: "empresa-A" });
  requireSuperAdmin.mockResolvedValue({
    sub: "admin-1",
    role: "SUPER_ADMIN",
    tenantId: null,
    email: "admin@ceasapro.com.br",
    name: "Operador",
    mustChangePassword: false,
  });
  assertSessaoValida.mockResolvedValue(undefined);
  clientIp.mockResolvedValue("1.2.3.4");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("withTenantAction — de onde vem o tenantId", () => {
  it("o tenantId vem da SESSÃO, e o do input é ignorado", async () => {
    /*
      A regra 1 do briefing, e a única que, quebrada, cruza dados entre
      empresas. O cliente controla o corpo da Server Action: se o wrapper
      lesse `tenantId` de lá, bastaria trocar o valor para escrever na
      empresa de outra pessoa.
    */
    const handler = vi.fn().mockResolvedValue("feito");
    const action = withTenantAction({
      schema: z.object({ tenantId: z.string() }).passthrough(),
      handler,
    });

    const r = await action({ tenantId: "empresa-DO-VIZINHO" });

    expect(r.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0]![1];
    expect(ctx.tenantId).toBe("empresa-A");
    expect(ctx.tenantId).not.toBe("empresa-DO-VIZINHO");
  });

  it("o userId vem do `sub` da sessão, não do input", async () => {
    const handler = vi.fn().mockResolvedValue(null);
    await withTenantAction({ handler })({ userId: "outro-usuario" });
    expect(handler.mock.calls[0]![1].userId).toBe("user-1");
  });

  it("o ip do ctx vem do cabeçalho resolvido, para a auditoria", async () => {
    const handler = vi.fn().mockResolvedValue(null);
    await withTenantAction({ handler })({});
    expect(handler.mock.calls[0]![1].ip).toBe("1.2.3.4");
  });
});

describe("withTenantAction — assinatura e senha", () => {
  it("assinatura bloqueada devolve 402 e NÃO roda o handler", async () => {
    const handler = vi.fn();
    requireTenant.mockResolvedValue({
      session: sessaoOk({ subStatus: "SUSPENSO" }),
      tenantId: "empresa-A",
    });

    const r = await withTenantAction({ handler })({});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PAYMENT_REQUIRED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("empresa bloqueada também devolve 402", async () => {
    const handler = vi.fn();
    requireTenant.mockResolvedValue({
      session: sessaoOk({ tenantStatus: "BLOCKED" }),
      tenantId: "empresa-A",
    });
    const r = await withTenantAction({ handler })({});
    expect(r.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("senha temporária trava a escrita antes de qualquer efeito", async () => {
    // O OWNER criado pelo admin nasce com `mustChangePassword`. Sem esta
    // trava ele escreveria no sistema sem nunca ter trocado a senha provisória.
    const handler = vi.fn();
    requireTenant.mockResolvedValue({
      session: sessaoOk({ mustChangePassword: true }),
      tenantId: "empresa-A",
    });

    const r = await withTenantAction({ handler })({});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/senha/i);
    expect(handler).not.toHaveBeenCalled();
  });

  it("trial e vencido PASSAM — só bloqueado é bloqueado", async () => {
    // `VENCIDO` tem período de graça para quem já pagou; travar aqui tiraria o
    // acesso de quem o contrato garante.
    for (const subStatus of ["TRIAL", "ATIVO", "VENCIDO"]) {
      const handler = vi.fn().mockResolvedValue("ok");
      requireTenant.mockResolvedValue({
        session: sessaoOk({ subStatus }),
        tenantId: "empresa-A",
      });
      const r = await withTenantAction({ handler })({});
      expect(r.ok, `subStatus ${subStatus} deveria passar`).toBe(true);
      expect(handler).toHaveBeenCalled();
    }
  });
});

describe("withTenantAction — sessão revogada", () => {
  it("sessão revogada no banco não passa, mesmo com token válido", async () => {
    /*
      O access token vale 15 minutos. Bloquear a empresa, trocar a senha ou
      excluir o usuário incrementa `sessionEpoch`, e é `assertSessaoValida`
      que compara o claim com o banco. Sem esta chamada, quem foi revogado
      continuaria ESCREVENDO por até 15 minutos.
    */
    const handler = vi.fn();
    const { UnauthorizedError } = await import("@/lib/http/app-error");
    assertSessaoValida.mockRejectedValue(new UnauthorizedError());

    const r = await withTenantAction({ handler })({});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNAUTHORIZED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("a revogação é conferida ANTES do módulo e do Zod", async () => {
    // A ordem importa para o diagnóstico: quem teve a sessão derrubada precisa
    // receber "entre de novo", e não "campo inválido" nem "contrate o módulo".
    const handler = vi.fn();
    const { UnauthorizedError } = await import("@/lib/http/app-error");
    assertSessaoValida.mockRejectedValue(new UnauthorizedError());

    const r = await withTenantAction({
      schema: z.object({ obrigatorio: z.string() }),
      module: "caixas",
      handler,
    })({ nada: true });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNAUTHORIZED");
  });
});

describe("withTenantAction — gate de módulo pago", () => {
  it("módulo fora do plano devolve erro e NÃO roda o handler", async () => {
    const handler = vi.fn();
    requireTenant.mockResolvedValue({
      session: sessaoOk({ modules: ["cotacoes"] }),
      tenantId: "empresa-A",
    });

    const r = await withTenantAction({ module: "caixas", handler })({});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(handler).not.toHaveBeenCalled();
  });

  it("é FAIL-CLOSED: sessão sem a lista de módulos não libera nada", async () => {
    // Um token antigo, emitido antes do claim `modules` existir, não pode
    // virar passe livre para os módulos pagos.
    const handler = vi.fn();
    requireTenant.mockResolvedValue({
      session: sessaoOk({ modules: undefined }),
      tenantId: "empresa-A",
    });

    const r = await withTenantAction({ module: "cotacoes", handler })({});

    expect(r.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("action sem `module:` não exige módulo nenhum (núcleo)", async () => {
    const handler = vi.fn().mockResolvedValue("ok");
    requireTenant.mockResolvedValue({
      session: sessaoOk({ modules: [] }),
      tenantId: "empresa-A",
    });

    const r = await withTenantAction({ handler })({});

    expect(r.ok).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("o gate de módulo vem ANTES do Zod", async () => {
    /*
      Quem não contratou tem de ouvir "contrate o módulo", não "campo
      inválido" — senão a pessoa conserta o formulário três vezes antes de
      descobrir que o problema era o plano.
    */
    const handler = vi.fn();
    requireTenant.mockResolvedValue({
      session: sessaoOk({ modules: [] }),
      tenantId: "empresa-A",
    });

    const r = await withTenantAction({
      schema: z.object({ obrigatorio: z.string() }),
      module: "caixas",
      handler,
    })({ obrigatorio: 123 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("withTenantAction — formato do erro", () => {
  it("erro de Zod vira VALIDATION com o mapa de campos", async () => {
    const handler = vi.fn();
    const r = await withTenantAction({
      schema: z.object({ nome: z.string().min(3, "Nome curto") }),
      handler,
    })({ nome: "ab" });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION");
      expect(r.error.fields).toEqual({ nome: "Nome curto" });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("AppError do serviço atravessa com código e mensagem próprios", async () => {
    const handler = vi.fn().mockRejectedValue(new NotFoundError("Produto não encontrado."));
    const r = await withTenantAction({ handler })({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("NOT_FOUND");
      expect(r.error.message).toBe("Produto não encontrado.");
    }
  });

  it("erro inesperado NÃO vaza a mensagem interna, e devolve uma referência", async () => {
    /*
      Mensagem de exceção crua costuma trazer nome de tabela, SQL ou caminho de
      arquivo. O usuário recebe um código curto para citar no suporte, e o
      detalhe fica no log do servidor.
    */
    const handler = vi.fn().mockRejectedValue(new Error("relation users does not exist"));
    const r = await withTenantAction({ handler })({});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("INTERNAL");
      expect(r.error.message).not.toContain("relation users");
      expect(r.error.message).toMatch(/ref: [a-z0-9]+/);
    }
  });

  it("o wrapper nunca lança — sempre devolve ActionResult", async () => {
    // Server Action que lança vira erro não tratado no cliente, sem toast e
    // sem diagnóstico. Todo caminho tem de sair por `{ ok: false }`.
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withTenantAction({ handler })({})).resolves.toMatchObject({ ok: false });
  });

  it("sem schema, a entrada crua chega ao handler", async () => {
    const handler = vi.fn().mockResolvedValue(null);
    await withTenantAction({ handler })({ qualquer: "coisa" });
    expect(handler.mock.calls[0]![0]).toEqual({ qualquer: "coisa" });
  });
});

describe("withAdminAction", () => {
  it("exige SUPER_ADMIN e não roda o handler sem ele", async () => {
    const handler = vi.fn();
    requireSuperAdmin.mockRejectedValue(new ForbiddenError());

    const r = await withAdminAction({ handler })({});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(handler).not.toHaveBeenCalled();
  });

  it("NÃO checa assinatura — o operador da plataforma não é cliente pagante", async () => {
    /*
      Assimetria deliberada em relação a `withTenantAction`, e vale fixar: se
      alguém "uniformizar" os dois wrappers acrescentando `assertActive` aqui,
      o super-admin perde o painel no dia em que o ambiente interno dele ficar
      com assinatura suspensa — justamente quando ele precisa entrar para
      consertar.
    */
    const handler = vi.fn().mockResolvedValue("ok");
    requireSuperAdmin.mockResolvedValue({
      sub: "admin-1",
      role: "SUPER_ADMIN",
      tenantId: null,
      email: "admin@ceasapro.com.br",
      name: "Operador",
      mustChangePassword: false,
      tenantStatus: "BLOCKED",
      subStatus: "SUSPENSO",
    });

    const r = await withAdminAction({ handler })({});

    expect(r.ok).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("mas SIM a troca de senha obrigatória", async () => {
    const handler = vi.fn();
    requireSuperAdmin.mockResolvedValue({
      sub: "admin-1",
      role: "SUPER_ADMIN",
      tenantId: null,
      email: "admin@ceasapro.com.br",
      name: "Operador",
      mustChangePassword: true,
    });

    const r = await withAdminAction({ handler })({});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/senha/i);
    expect(handler).not.toHaveBeenCalled();
  });

  it("também confere revogação de sessão", async () => {
    const handler = vi.fn();
    const { UnauthorizedError } = await import("@/lib/http/app-error");
    assertSessaoValida.mockRejectedValue(new UnauthorizedError());
    const r = await withAdminAction({ handler })({});
    expect(r.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("o ctx do admin não tem tenantId — ele não opera dentro de cliente", async () => {
    const handler = vi.fn().mockResolvedValue(null);
    await withAdminAction({ handler })({});
    const ctx = handler.mock.calls[0]![1];
    expect(ctx.userId).toBe("admin-1");
    expect(ctx).not.toHaveProperty("tenantId");
  });
});
