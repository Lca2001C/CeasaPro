import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Sessão revogada numa NAVEGAÇÃO: o layout redireciona, não lança.
 *
 * Os layouts `(app)` e `(admin)` chamavam `assertSessaoValida`, que lança
 * `UnauthorizedError`. O `error.tsx` de um grupo não cobre o PRÓPRIO layout,
 * então a exceção ia para o `global-error` — só "Tentar de novo", que falha
 * igual — e o proxy devolvia o `/login` para a home enquanto o access cookie
 * vivesse. Até 15 minutos sem saída, depois de trocar a senha em outro
 * aparelho ou de a empresa ser bloqueada.
 */

const getSession = vi.fn();
const sessaoAindaValida = vi.fn();
const redirect = vi.fn((url: string) => {
  // Igual ao Next: `redirect` interrompe a renderização lançando.
  throw Object.assign(new Error("NEXT_REDIRECT"), { url });
});

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
vi.mock("@/lib/auth/session", () => ({ getSession: () => getSession() }));
vi.mock("@/lib/auth/revogacao", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/auth/revogacao")>("@/lib/auth/revogacao");
  return { ...real, sessaoAindaValida: (s: unknown) => sessaoAindaValida(s) };
});
// O resto do layout não interessa aqui: se a renderização passar do ponto de
// conferência, estes mocks são chamados e o teste enxerga.
const tenantFindUnique = vi.fn();
const contarNaoLidas = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: { tenant: { findUnique: (a: unknown) => tenantFindUnique(a) } },
}));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/components/layout/admin-shell", () => ({ AdminShell: () => null }));
vi.mock("@/components/auth/sessao-viva", () => ({ SessaoViva: () => null }));
vi.mock("@/lib/services/admin-notifications.service", () => ({
  AdminNotificationsService: { contarNaoLidas: () => contarNaoLidas() },
}));

const { sessaoConfere } = await import("@/lib/auth/revogacao");
const { rotaDeSessaoRevogada, veioDeSessaoRevogada, destinoSeguro } = await import(
  "@/lib/auth/renovacao"
);
const { default: AppLayout } = await import("@/app/(app)/layout");
const { default: AdminLayout } = await import("@/app/(admin)/layout");

const DONO = {
  sub: "user-1",
  role: "OWNER",
  tenantId: "empresa-A",
  tenantStatus: "ACTIVE",
  subStatus: "ATIVO",
  modules: [],
  mustChangePassword: false,
  name: "Dono",
  email: "dono@box.com",
  sev: 3,
  tev: 1,
};
const ADMIN = { ...DONO, role: "SUPER_ADMIN", tenantId: null };

type Layout = (p: { children: React.ReactNode }) => Promise<unknown>;

/** Renderiza o layout e devolve para onde ele redirecionou (ou null). */
async function destinoDo(layout: Layout) {
  try {
    await layout({ children: null });
    return null;
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (url === undefined) throw e;
    return url;
  }
}

beforeEach(() => {
  sessaoAindaValida.mockResolvedValue(true);
  tenantFindUnique.mockResolvedValue(null);
  contarNaoLidas.mockResolvedValue({ total: 0, saturado: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("sessaoConfere — a regra, sem banco", () => {
  const linha = { ue: 3, ativo: true, excluido: null, te: 1 };

  it("epochs em dia e conta ativa: vale", () => {
    expect(sessaoConfere({ sev: 3, tev: 1 }, linha)).toBe(true);
  });

  it("senha trocada em outro aparelho (epoch do usuário subiu): não vale", () => {
    expect(sessaoConfere({ sev: 3, tev: 1 }, { ...linha, ue: 4 })).toBe(false);
  });

  it("empresa bloqueada (epoch da empresa subiu): não vale", () => {
    expect(sessaoConfere({ sev: 3, tev: 1 }, { ...linha, te: 2 })).toBe(false);
  });

  it("usuário desativado, excluído ou inexistente: não vale", () => {
    expect(sessaoConfere({ sev: 3, tev: 1 }, { ...linha, ativo: false })).toBe(false);
    expect(sessaoConfere({ sev: 3, tev: 1 }, { ...linha, excluido: new Date() })).toBe(false);
    expect(sessaoConfere({ sev: 3, tev: 1 }, undefined)).toBe(false);
  });

  it("super-admin sem empresa ignora o epoch de empresa", () => {
    expect(sessaoConfere({ sev: 3 }, { ...linha, te: null })).toBe(true);
  });

  it("token sem claims vale como epoch 0", () => {
    expect(sessaoConfere({}, { ...linha, ue: 0, te: 0 })).toBe(true);
    expect(sessaoConfere({}, { ...linha, ue: 1, te: 0 })).toBe(false);
  });
});

describe("rotaDeSessaoRevogada", () => {
  it("aponta para a renovação, com o destino e a marca de origem", () => {
    const url = new URL(rotaDeSessaoRevogada("/dashboard"), "http://x");
    expect(url.pathname).toBe("/api/auth/renovar");
    expect(url.searchParams.get("next")).toBe("/dashboard");
    expect(veioDeSessaoRevogada(url.searchParams)).toBe(true);
  });

  it("destino de fora passa pelo mesmo filtro anti-redirecionamento-aberto", () => {
    const url = new URL(rotaDeSessaoRevogada("//golpe.com"), "http://x");
    expect(url.searchParams.get("next")).toBe(destinoSeguro("//golpe.com"));
    expect(url.searchParams.get("next")).toBe("/");
  });

  it("sem a marca, a requisição NÃO é tratada como vinda do layout", () => {
    expect(veioDeSessaoRevogada(new URLSearchParams("next=/dashboard"))).toBe(false);
    expect(veioDeSessaoRevogada(new URLSearchParams("next=/dashboard&revogada=0"))).toBe(false);
  });
});

describe("layout (app)", () => {
  it("sessão revogada REDIRECIONA para a saída — não lança para o global-error", async () => {
    getSession.mockResolvedValue(DONO);
    sessaoAindaValida.mockResolvedValue(false);

    expect(await destinoDo(AppLayout)).toBe(rotaDeSessaoRevogada("/dashboard"));
    // Não leu nada da empresa de quem já não tem sessão.
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it("revogada com empresa bloqueada no token: a revogação vem primeiro", async () => {
    /*
      Mandar para `/conta/suspensa` com uma sessão que o banco já recusou só
      adiaria o mesmo impasse. O login novo emite o status atual, e o proxy
      desvia para `/conta/suspensa` a partir dele.
    */
    getSession.mockResolvedValue({ ...DONO, tenantStatus: "BLOCKED", subStatus: "BLOQUEADO" });
    sessaoAindaValida.mockResolvedValue(false);

    expect(await destinoDo(AppLayout)).toBe(rotaDeSessaoRevogada("/dashboard"));
  });

  it("sessão válida de empresa bloqueada continua indo a /conta/suspensa", async () => {
    getSession.mockResolvedValue({ ...DONO, tenantStatus: "BLOCKED", subStatus: "BLOQUEADO" });
    expect(await destinoDo(AppLayout)).toBe("/conta/suspensa");
  });

  it("sessão válida segue para o shell", async () => {
    getSession.mockResolvedValue(DONO);
    expect(await destinoDo(AppLayout)).toBeNull();
    expect(tenantFindUnique).toHaveBeenCalledOnce();
  });

  it("sem sessão continua indo ao /login, sem consultar o banco", async () => {
    getSession.mockResolvedValue(null);
    expect(await destinoDo(AppLayout)).toBe("/login");
    expect(sessaoAindaValida).not.toHaveBeenCalled();
  });

  it("falha de BANCO ainda lança — aí o 'Tentar de novo' é a resposta certa", async () => {
    getSession.mockResolvedValue(DONO);
    sessaoAindaValida.mockRejectedValue(new Error("pool esgotado"));
    await expect(AppLayout({ children: null })).rejects.toThrow("pool esgotado");
  });
});

describe("layout (admin)", () => {
  it("sessão revogada do super-admin redireciona para a saída, voltando a /admin", async () => {
    getSession.mockResolvedValue(ADMIN);
    sessaoAindaValida.mockResolvedValue(false);

    expect(await destinoDo(AdminLayout)).toBe(rotaDeSessaoRevogada("/admin"));
    expect(contarNaoLidas).not.toHaveBeenCalled();
  });

  it("sessão válida segue para o painel", async () => {
    getSession.mockResolvedValue(ADMIN);
    expect(await destinoDo(AdminLayout)).toBeNull();
    expect(contarNaoLidas).toHaveBeenCalledOnce();
  });
});
