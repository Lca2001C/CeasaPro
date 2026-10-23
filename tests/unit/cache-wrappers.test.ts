import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Os wrappers de escrita trocam a versão da empresa — é o que impede o Início
 * de mostrar o "hoje vendi" de antes da venda.
 */

const session = {
  sub: "u1",
  role: "OWNER",
  tenantId: "t1",
  email: "dono@exemplo.com",
  name: "Dono",
  mustChangePassword: false,
  tenantStatus: "ACTIVE",
  subStatus: "ATIVO",
  modules: [],
};

vi.mock("@/lib/auth/session", () => ({
  requireTenant: async () => ({ session, tenantId: "t1" }),
  requireSuperAdmin: async () => session,
}));
vi.mock("@/lib/auth/revogacao", () => ({ assertSessaoValida: async () => {} }));
vi.mock("@/lib/http/request", () => ({ clientIp: async () => "1.2.3.4" }));

const { clienteEmMemoria, definirClienteDeCache } = await import("@/lib/cache/cliente");
const { lembrar, versao } = await import("@/lib/cache/cache");
const { withTenantAction } = await import("@/lib/http/with-action");
const { withTenantRoute } = await import("@/lib/http/with-route");

let valor = 0;
const ler = () => lembrar({ chave: "dash:t1", versoes: [versao.tenant("t1")], ttlSeg: 60 }, async () => valor);

beforeEach(() => {
  definirClienteDeCache(clienteEmMemoria());
  valor = 1;
});
afterEach(() => definirClienteDeCache(undefined));

describe("invalidação nos wrappers", () => {
  it("Server Action da empresa troca a versão", async () => {
    expect(await ler()).toBe(1);
    valor = 2;
    const acao = withTenantAction({ handler: async () => "ok" });
    expect((await acao()).ok).toBe(true);
    expect(await ler()).toBe(2);
  });

  it("troca também quando o handler lança (pode ter gravado antes)", async () => {
    await ler();
    valor = 2;
    const acao = withTenantAction({
      handler: async () => {
        throw new Error("depois de gravar");
      },
    });
    expect((await acao()).ok).toBe(false);
    expect(await ler()).toBe(2);
  });

  it("POST de rota troca a versão; GET (export) não", async () => {
    await ler();
    valor = 2;
    const rota = withTenantRoute({ handler: async () => ({ ok: true }) });
    await rota(new Request("http://localhost/api/reports/x", { method: "GET" }));
    expect(await ler()).toBe(1);
    await rota(
      new Request("http://localhost/api/vendas", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", origin: "http://localhost" },
      }),
    );
    expect(await ler()).toBe(2);
  });
});
