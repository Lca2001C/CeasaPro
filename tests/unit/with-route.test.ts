import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

/**
 * O wrapper dos Route Handlers — a outra barreira que ninguém executava.
 *
 * `withTenantRoute` protege as rotas TRANSACIONAIS: venda, compra, ajuste de
 * estoque, fiado, pagamento de fiado, checkout, push e exportação de relatório.
 * São os caminhos que mexem em dinheiro e em estoque, e a medição de cobertura
 * mostrou `src/lib/http` em 18,3% — este arquivo nunca era executado.
 *
 * Ele é parecido com `with-action.ts`, mas tem três diferenças que só existem
 * aqui, e é nelas que os testes se concentram:
 *
 *  - devolve **Response HTTP** com código de status, não `ActionResult`;
 *  - tem `allowInactive`, a exceção que deixa quem está bloqueado chegar à
 *    tela de pagamento (sem ela, cliente suspenso não consegue regularizar);
 *  - tem throttle por empresa, que é o único limite das rotas de escrita.
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

const { withTenantRoute, withAdminRoute } = await import("@/lib/http/with-route");
const { NotFoundError } = await import("@/lib/http/app-error");

/**
 * Cada teste usa um tenant PRÓPRIO.
 *
 * O throttle de `with-route.ts` guarda o contador num `Map` de módulo, com
 * chave `route:<tenantId>`. Reaproveitar o mesmo id faria um teste herdar a
 * contagem do anterior e a suíte falharia conforme a ordem — que é o tipo de
 * intermitência que ninguém consegue diagnosticar depois.
 */
let n = 0;
const novoTenant = () => `empresa-${++n}-${Math.random().toString(36).slice(2, 7)}`;

function sessaoOk(tenantId: string, over: Record<string, unknown> = {}) {
  return {
    sub: "user-1",
    role: "OWNER",
    tenantId,
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

function comSessao(tenantId: string, over: Record<string, unknown> = {}) {
  requireTenant.mockResolvedValue({ session: sessaoOk(tenantId, over), tenantId });
}

const post = (corpo: unknown, url = "http://localhost/api/x") =>
  new Request(url, { method: "POST", body: JSON.stringify(corpo) });

beforeEach(() => {
  assertSessaoValida.mockResolvedValue(undefined);
  clientIp.mockResolvedValue("1.2.3.4");
  requireSuperAdmin.mockResolvedValue({
    sub: "admin-1",
    role: "SUPER_ADMIN",
    tenantId: null,
    email: "admin@ceasapro.com.br",
    name: "Operador",
    mustChangePassword: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("withTenantRoute — de onde vem o tenantId", () => {
  it("o tenantId vem da SESSÃO; o do corpo é ignorado", async () => {
    const t = novoTenant();
    comSessao(t);
    const handler = vi.fn().mockResolvedValue({ feito: true });

    const r = await withTenantRoute({ handler })(post({ tenantId: "empresa-DO-VIZINHO" }));

    expect(r.status).toBe(200);
    const ctx = handler.mock.calls[0]![1];
    expect(ctx.tenantId).toBe(t);
    expect(ctx.tenantId).not.toBe("empresa-DO-VIZINHO");
  });
});

describe("withTenantRoute — assinatura e a exceção que permite pagar", () => {
  it("bloqueado devolve 402 e não roda o handler", async () => {
    comSessao(novoTenant(), { subStatus: "SUSPENSO" });
    const handler = vi.fn();

    const r = await withTenantRoute({ handler })(post({}));

    expect(r.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
  });

  it("`allowInactive` deixa o bloqueado PASSAR — é como ele regulariza", async () => {
    /*
      A exceção mais importante deste arquivo. As rotas de billing precisam
      responder a quem está suspenso: é exatamente essa pessoa que vai pagar.
      Sem `allowInactive`, o cliente inadimplente bate em 402 ao tentar gerar o
      PIX — e fica preso, sem caminho de volta, com a plataforma perdendo a
      receita que o bloqueio existia para cobrar.
    */
    comSessao(novoTenant(), { subStatus: "SUSPENSO", tenantStatus: "SUSPENDED" });
    const handler = vi.fn().mockResolvedValue({ qr: "..." });

    const r = await withTenantRoute({ allowInactive: true, handler })(post({}));

    expect(r.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it("senha temporária trava mesmo com `allowInactive`", async () => {
    // `allowInactive` afrouxa a COBRANÇA, não a identidade.
    comSessao(novoTenant(), { mustChangePassword: true });
    const handler = vi.fn();

    const r = await withTenantRoute({ allowInactive: true, handler })(post({}));

    expect(r.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withTenantRoute — sessão revogada e gate de módulo", () => {
  it("sessão revogada devolve 401 antes de tudo", async () => {
    comSessao(novoTenant());
    const { UnauthorizedError } = await import("@/lib/http/app-error");
    assertSessaoValida.mockRejectedValue(new UnauthorizedError());
    const handler = vi.fn();

    const r = await withTenantRoute({ handler })(post({}));

    expect(r.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("módulo fora do plano devolve 403", async () => {
    comSessao(novoTenant(), { modules: [] });
    const handler = vi.fn();

    const r = await withTenantRoute({ module: "caixas", handler })(post({}));

    expect(r.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("é fail-closed: sem a lista de módulos, 403", async () => {
    comSessao(novoTenant(), { modules: undefined });
    const handler = vi.fn();
    const r = await withTenantRoute({ module: "cotacoes", handler })(post({}));
    expect(r.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withTenantRoute — throttle por empresa", () => {
  it("passa dentro do limite e devolve 429 depois dele", async () => {
    /*
      120 por minuto, por empresa. É o único limite das rotas de escrita, e
      existe para conter abuso acidental — loop de UI, cliente repetindo a
      requisição. Não segura ataque (é contador em memória, e em serverless
      cada requisição pode cair numa instância diferente); quem segura força
      bruta é o `rate-limit-db.ts`, no Postgres, usado pelas rotas de auth.
    */
    const t = novoTenant();
    comSessao(t);
    const handler = vi.fn().mockResolvedValue(null);
    const rota = withTenantRoute({ handler });

    for (let i = 0; i < 120; i++) {
      expect((await rota(post({}))).status, `requisição ${i + 1}`).toBe(200);
    }
    const excedente = await rota(post({}));

    expect(excedente.status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(120);
  });

  it("o contador é POR EMPRESA — uma não derruba a outra", async () => {
    const a = novoTenant();
    comSessao(a);
    const rota = withTenantRoute({ handler: vi.fn().mockResolvedValue(null) });
    for (let i = 0; i < 121; i++) await rota(post({}));
    expect((await rota(post({}))).status).toBe(429);

    const b = novoTenant();
    comSessao(b);
    expect((await rota(post({}))).status).toBe(200);
  });
});

describe("withTenantRoute — entrada e saída", () => {
  it("erro de schema devolve 422 com o mapa de campos", async () => {
    comSessao(novoTenant());
    const handler = vi.fn();

    const r = await withTenantRoute({
      schema: z.object({ qtd: z.number().positive("Quantidade inválida") }),
      handler,
    })(post({ qtd: -1 }));

    expect(r.status).toBe(422);
    const corpo = await r.json();
    expect(corpo.error.code).toBe("VALIDATION");
    expect(corpo.error.fields).toEqual({ qtd: "Quantidade inválida" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("corpo que não é JSON vira objeto vazio, e o Zod é quem recusa", async () => {
    // `req.json()` lança em corpo malformado. Sem o catch, isso viraria 500
    // ("erro inesperado") em vez de 422 ("dados inválidos") — e o cliente não
    // saberia que o problema era dele.
    comSessao(novoTenant());
    const req = new Request("http://localhost/api/x", { method: "POST", body: "{ isto não é json" });

    const r = await withTenantRoute({
      schema: z.object({ nome: z.string() }),
      handler: vi.fn(),
    })(req);

    expect(r.status).toBe(422);
  });

  it("`source: query` lê a querystring em vez do corpo", async () => {
    comSessao(novoTenant());
    const handler = vi.fn().mockResolvedValue(null);

    await withTenantRoute({
      source: "query",
      schema: z.object({ tipo: z.string() }),
      handler,
    })(new Request("http://localhost/api/x?tipo=vendas"));

    expect(handler.mock.calls[0]![0]).toEqual({ tipo: "vendas" });
  });

  it("handler que devolve Response passa intacto (exportação de arquivo)", async () => {
    /*
      As rotas de exportação devolvem o .xlsx/.pdf com o próprio
      `Content-Type` e `Content-Disposition`. Embrulhar isso em
      `{ ok: true, data }` entregaria JSON com o binário dentro, e o download
      chegaria corrompido.
    */
    comSessao(novoTenant());
    const arquivo = new Response("conteudo", {
      headers: { "content-type": "application/vnd.ms-excel" },
    });

    const r = await withTenantRoute({ handler: async () => arquivo })(post({}));

    expect(r).toBe(arquivo);
    expect(r.headers.get("content-type")).toBe("application/vnd.ms-excel");
  });

  it("dado comum sai embrulhado em { ok: true, data }", async () => {
    comSessao(novoTenant());
    const r = await withTenantRoute({ handler: async () => ({ id: "v1" }) })(post({}));
    expect(await r.json()).toEqual({ ok: true, data: { id: "v1" } });
  });

  it("AppError do serviço vira o status dela", async () => {
    comSessao(novoTenant());
    const r = await withTenantRoute({
      handler: vi.fn().mockRejectedValue(new NotFoundError("Venda não encontrada.")),
    })(post({}));

    expect(r.status).toBe(404);
    expect((await r.json()).error.message).toBe("Venda não encontrada.");
  });

  it("erro inesperado vira 500 sem vazar a mensagem interna", async () => {
    comSessao(novoTenant());
    const r = await withTenantRoute({
      handler: vi.fn().mockRejectedValue(new Error("relation sales does not exist")),
    })(post({}));

    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo.error.message).not.toContain("relation sales");
    expect(corpo.error.message).toMatch(/ref: [a-z0-9]+/);
  });

  it("o wrapper nunca lança — sempre devolve Response", async () => {
    comSessao(novoTenant());
    const r = await withTenantRoute({
      handler: vi.fn().mockRejectedValue(new Error("boom")),
    })(post({}));
    expect(r).toBeInstanceOf(Response);
  });
});

describe("withAdminRoute", () => {
  it("exige SUPER_ADMIN", async () => {
    const { ForbiddenError } = await import("@/lib/http/app-error");
    requireSuperAdmin.mockRejectedValue(new ForbiddenError());
    const handler = vi.fn();

    const r = await withAdminRoute({ handler })(post({}));

    expect(r.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("não tem throttle por empresa — o operador não tem empresa", async () => {
    // Assimetria deliberada: a chave do throttle é `route:<tenantId>`, e o
    // admin não tem tenant. Acrescentar o limite aqui exigiria inventar uma
    // chave, e limitaria o operador justamente quando ele está apagando
    // incêndio no painel.
    const handler = vi.fn().mockResolvedValue(null);
    const rota = withAdminRoute({ handler });
    for (let i = 0; i < 130; i++) {
      expect((await rota(post({}))).status, `requisição ${i + 1}`).toBe(200);
    }
  });

  it("também confere revogação de sessão", async () => {
    const { UnauthorizedError } = await import("@/lib/http/app-error");
    assertSessaoValida.mockRejectedValue(new UnauthorizedError());
    const handler = vi.fn();
    const r = await withAdminRoute({ handler })(post({}));
    expect(r.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});
