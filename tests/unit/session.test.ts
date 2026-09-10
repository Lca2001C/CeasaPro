import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `src/lib/auth/session.ts` — a porta por onde 46 páginas e os 4 wrappers leem
 * quem está logado.
 *
 * São 52 linhas e nenhuma tinha teste. Elas decidem três coisas: se há sessão,
 * qual é o papel, e — a que mais importa — **de onde sai o `tenantId`**, que é
 * a regra 1 do briefing (`docs/CONTEXTO-AGENTE.md`): o tenant vem só da sessão
 * JWT, nunca do corpo ou da query.
 *
 * `with-action.test.ts` e `with-route.test.ts` mockam este módulo para poder
 * controlar a sessão; aqui ele roda de verdade, com o cookie e o `verifyAccess`
 * sob controle.
 */

const readAccessCookie = vi.fn();
const verifyAccess = vi.fn();

vi.mock("@/lib/auth/cookies", () => ({
  readAccessCookie: () => readAccessCookie(),
}));
vi.mock("@/lib/auth/jwt", () => ({
  verifyAccess: (t: string) => verifyAccess(t),
  ACCESS_COOKIE: "ceasa_at",
  REFRESH_COOKIE: "ceasa_rt",
}));

const { getSession, requireAuth, requireRole, requireSuperAdmin, requireTenant } = await import(
  "@/lib/auth/session"
);
const { UnauthorizedError, ForbiddenError } = await import("@/lib/http/app-error");

function payload(over: Record<string, unknown> = {}) {
  return {
    sub: "user-1",
    role: "OWNER",
    tenantId: "empresa-A",
    email: "dono@box.com",
    name: "Dono",
    tenantStatus: "ACTIVE",
    subStatus: "ATIVO",
    modules: [],
    mustChangePassword: false,
    ...over,
  };
}

beforeEach(() => {
  readAccessCookie.mockResolvedValue("token-valido");
  verifyAccess.mockResolvedValue(payload());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getSession", () => {
  it("sem cookie, devolve null sem tentar verificar nada", async () => {
    readAccessCookie.mockResolvedValue(null);

    expect(await getSession()).toBeNull();
    // Não é detalhe de desempenho: chamar `verifyAccess(undefined)` produziria
    // uma exceção de biblioteca no lugar de um "não está logado" limpo.
    expect(verifyAccess).not.toHaveBeenCalled();
  });

  it("com cookie, devolve o payload verificado", async () => {
    const s = await getSession();
    expect(s?.sub).toBe("user-1");
    expect(verifyAccess).toHaveBeenCalledWith("token-valido");
  });
});

describe("requireAuth", () => {
  it("sem sessão, lança UnauthorizedError", async () => {
    readAccessCookie.mockResolvedValue(null);
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("token inválido propaga o erro da verificação, e não vira sessão", async () => {
    // Assinatura errada, `aud` errado, `typ` trocado — tudo isso sai de
    // `verifyAccess`. Engolir aqui transformaria token forjado em anônimo
    // silencioso, e o chamador seguiria como se ninguém estivesse logado.
    verifyAccess.mockRejectedValue(new UnauthorizedError("assinatura inválida"));
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("requireRole e requireSuperAdmin", () => {
  it("papel diferente do exigido é ForbiddenError, não Unauthorized", async () => {
    // A distinção importa no cliente: 401 manda para o login, 403 diz que a
    // pessoa está logada e não pode. Mandar um OWNER logado para o login ao
    // tocar numa tela de admin criaria um laço.
    await expect(requireRole("SUPER_ADMIN")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("aceita quando o papel está na lista", async () => {
    const s = await requireRole("OWNER", "SUPER_ADMIN");
    expect(s.role).toBe("OWNER");
  });

  it("requireSuperAdmin recusa OWNER e aceita SUPER_ADMIN", async () => {
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(ForbiddenError);

    verifyAccess.mockResolvedValue(payload({ role: "SUPER_ADMIN", tenantId: null }));
    expect((await requireSuperAdmin()).role).toBe("SUPER_ADMIN");
  });
});

describe("requireTenant — de onde sai o tenantId", () => {
  it("devolve o tenantId que está NA SESSÃO", async () => {
    const { session, tenantId } = await requireTenant();
    expect(tenantId).toBe("empresa-A");
    expect(tenantId).toBe(session.tenantId);
  });

  it("usuário sem empresa não passa", async () => {
    verifyAccess.mockResolvedValue(payload({ tenantId: null }));
    await expect(requireTenant()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("SUPER_ADMIN COM ambiente próprio passa", async () => {
    /*
      Assimetria deliberada, documentada no fonte: o operador da plataforma
      também usa o sistema — para testar, demonstrar, conferir um cálculo — e
      isso acontece num tenant DELE, nunca no de um cliente. Como o `tenantId`
      continua saindo da sessão, o isolamento é o mesmo de sempre.
    */
    verifyAccess.mockResolvedValue(
      payload({ role: "SUPER_ADMIN", tenantId: "ambiente-do-admin" }),
    );

    const { tenantId } = await requireTenant();
    expect(tenantId).toBe("ambiente-do-admin");
  });

  it("SUPER_ADMIN SEM ambiente provisionado não passa", async () => {
    verifyAccess.mockResolvedValue(payload({ role: "SUPER_ADMIN", tenantId: null }));
    await expect(requireTenant()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("um papel que não é OWNER nem SUPER_ADMIN não entra na área da empresa", async () => {
    // Hoje o enum só tem os dois, mas o guard existe para o dia em que um
    // terceiro aparecer: sem ele, o papel novo herdaria acesso por omissão.
    verifyAccess.mockResolvedValue(payload({ role: "STAFF", tenantId: "empresa-A" }));
    await expect(requireTenant()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sem sessão nenhuma, é 401 e não 403", async () => {
    readAccessCookie.mockResolvedValue(null);
    await expect(requireTenant()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
